import json
import os
import uuid

import numpy as np
import pandas as pd
from flask import Flask, jsonify, request, send_file
from werkzeug.utils import secure_filename

import predict_pipeline


BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")
DATA_DIR = os.path.join(BASE_DIR, "data")
TEMP_DIR = os.path.join(BASE_DIR, "temp_downloads")
SUMMARY_PATH = os.path.join(STATIC_DIR, "dashboard_summary.json")
RAW_DATA_PATH = os.path.join(DATA_DIR, "finance_marketing_01.csv")
RETENTION_TARGETS_PATH = os.path.join(DATA_DIR, "retention_targets.csv")
CROSSSELL_TARGETS_PATH = os.path.join(DATA_DIR, "cross_sell_targets.csv")

os.makedirs(TEMP_DIR, exist_ok=True)

app = Flask(__name__, static_folder="static", static_url_path="")
predict_pipeline.load_assets()
predict_pipeline.build_integrated_pipelines()


@app.route("/")
def index():
    return app.send_static_file("index.html")


@app.route("/api/summary")
def summary():
    with open(SUMMARY_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)
    model_config = predict_pipeline.load_assets()["config"]
    data["config"].update({
        "churn_threshold": float(model_config["churn_threshold"]),
        "crosssell_threshold": float(model_config["crosssell_threshold"]),
        "selected_churn_model": model_config.get("selected_churn_model"),
        "selected_crosssell_model": model_config.get("selected_crosssell_model"),
    })
    return jsonify(data)


@app.route("/api/customers/<list_type>")
def customer_list(list_type):
    if list_type not in {"retention", "crosssell"}:
        return jsonify({"error": "Unknown customer list type"}), 404

    try:
        df_customers = _load_customer_list(list_type)
        return jsonify([_clean_record(row) for row in df_customers.to_dict(orient="records")])
    except Exception as exc:
        return jsonify({"error": str(exc)}), 400


@app.route("/api/predict", methods=["POST"])
def predict_single():
    payload = request.get_json(silent=True)
    if not payload:
        return jsonify({"error": "No input data provided"}), 400

    try:
        df_scored = predict_pipeline.score_dataframe(pd.DataFrame([payload]))
        prediction = _clean_record(df_scored.iloc[0].to_dict())
        contributions = predict_pipeline.explain_customer(prediction)
        return jsonify({"predictions": prediction, "contributions": contributions})
    except Exception as exc:
        return jsonify({"error": str(exc)}), 400


@app.route("/api/upload", methods=["POST"])
def upload():
    if "file" not in request.files:
        return jsonify({"error": "No file uploaded"}), 400

    file = request.files["file"]
    if not file.filename:
        return jsonify({"error": "No file selected"}), 400
    if not file.filename.lower().endswith(".csv"):
        return jsonify({"error": "Please upload a CSV file"}), 400

    try:
        df_uploaded = pd.read_csv(file)
        missing = [col for col in predict_pipeline.expected_input_columns() if col not in df_uploaded.columns]
        if missing:
            return jsonify({"error": f"Missing required columns: {', '.join(missing)}"}), 400

        df_scored = predict_pipeline.score_dataframe(df_uploaded)
        file_key = str(uuid.uuid4())
        save_path = os.path.join(TEMP_DIR, f"{file_key}.csv")
        df_scored.to_csv(save_path, index=False)
        retention_df = df_scored[df_scored["churn_flag"] == 1].sort_values("churn_prob", ascending=False)
        crosssell_df = df_scored[df_scored["crosssell_flag"] == 1].sort_values("accept_prob", ascending=False)
        retention_df.to_csv(os.path.join(TEMP_DIR, f"{file_key}_retention.csv"), index=False)
        crosssell_df.to_csv(os.path.join(TEMP_DIR, f"{file_key}_crosssell.csv"), index=False)

        preview_cols = [
            "customer_id",
            "churn_prob",
            "churn_flag",
            "churn_risk_band",
            "accept_prob",
            "crosssell_flag",
            "crosssell_prob_band",
        ]
        preview_cols = [col for col in preview_cols if col in df_scored.columns]
        preview = [_clean_record(row) for row in df_scored[preview_cols].head(5).to_dict(orient="records")]
        campaign_cols = [
            "customer_id",
            "churn_prob",
            "churn_risk_band",
            "accept_prob",
            "crosssell_prob_band",
            "recommended_action",
        ]
        campaign_cols = [col for col in campaign_cols if col in df_scored.columns]
        retention_targets = [
            _clean_record(row)
            for row in retention_df[campaign_cols].head(10).to_dict(orient="records")
        ]
        crosssell_targets = [
            _clean_record(row)
            for row in crosssell_df[campaign_cols].head(10).to_dict(orient="records")
        ]

        return jsonify({
            "file_key": file_key,
            "filename": f"scored_{secure_filename(file.filename)}",
            "stats": {
                "total_rows": int(len(df_scored)),
                "churn_flags": int(df_scored["churn_flag"].sum()),
                "crosssell_flags": int(df_scored["crosssell_flag"].sum()),
                "churn_rate": float(df_scored["churn_flag"].mean()),
                "crosssell_rate": float(df_scored["crosssell_flag"].mean()),
            },
            "downloads": {
                "scored": f"/api/download/{file_key}",
                "retention": f"/api/download/{file_key}/retention",
                "crosssell": f"/api/download/{file_key}/crosssell",
            },
            "campaign_lists": {
                "retention": retention_targets,
                "crosssell": crosssell_targets,
            },
            "preview": preview,
        })
    except Exception as exc:
        return jsonify({"error": str(exc)}), 400


@app.route("/api/download/<file_key>")
def download(file_key):
    safe_key = secure_filename(f"{file_key}.csv")
    path = os.path.join(TEMP_DIR, safe_key)
    if not os.path.exists(path):
        return jsonify({"error": "File not found or expired"}), 404
    return send_file(path, as_attachment=True, download_name="scored_customers_output.csv")


@app.route("/api/download/<file_key>/<list_type>")
def download_campaign_list(file_key, list_type):
    if list_type not in {"retention", "crosssell"}:
        return jsonify({"error": "Unknown list type"}), 404
    safe_key = secure_filename(f"{file_key}_{list_type}.csv")
    path = os.path.join(TEMP_DIR, safe_key)
    if not os.path.exists(path):
        return jsonify({"error": "File not found or expired"}), 404
    filename = "retention_targets.csv" if list_type == "retention" else "crosssell_targets.csv"
    return send_file(path, as_attachment=True, download_name=filename)


def _clean_record(record):
    clean = {}
    for key, value in record.items():
        if pd.isna(value):
            clean[key] = None
        elif isinstance(value, (np.integer, np.floating)):
            clean[key] = value.item()
        else:
            clean[key] = value
    return clean


def _load_customer_list(list_type):
    profile_cols = [
        "customer_id", "age", "gender", "marital_status", "education_level",
        "occupation", "city_tier", "region", "annual_income", "account_type",
        "tenure_months", "credit_score", "account_balance", "num_products_held",
        "avg_monthly_transactions", "avg_transaction_value", "digital_channel_usage_pct",
        "missed_payments_6m", "branch_visits_monthly", "customer_service_calls_6m",
        "complaint_raised", "nps_score", "campaigns_sent_12m", "campaigns_opened_12m",
        "campaigns_clicked_12m", "preferred_campaign_channel", "last_campaign_type",
        "days_since_last_campaign", "campaign_offer_category", "clv_score",
        "clv_segment", "risk_segment", "churned", "cross_sell_accepted",
    ]
    profiles = pd.read_csv(RAW_DATA_PATH, usecols=profile_cols)

    if list_type == "retention":
        targets = pd.read_csv(RETENTION_TARGETS_PATH)
        merged = targets.merge(profiles, on="customer_id", how="left", suffixes=("_target", ""))
        merged["list_type"] = "retention"
        merged["recommended_action"] = "Retention Follow-up"
        merged["accept_prob"] = 0.0
        merged["crosssell_prob_band"] = "Not prioritized"
        sort_col = "churn_prob"
    else:
        targets = pd.read_csv(CROSSSELL_TARGETS_PATH)
        merged = targets.merge(profiles, on="customer_id", how="left", suffixes=("_target", ""))
        merged["list_type"] = "crosssell"
        merged["recommended_action"] = "Cross-Sell Offer"
        merged["churn_prob"] = 0.0
        merged["churn_risk_band"] = "Not prioritized"
        config = predict_pipeline.load_assets()["config"]
        merged["crosssell_prob_band"] = pd.cut(
            merged["accept_prob"].clip(0, 1),
            bins=config.get("crosssell_band_edges", [0.0, 0.2418, 0.3268, 1.0]),
            labels=["Low Probability", "Medium Probability", "High Probability"],
            include_lowest=True,
        ).astype(str)
        sort_col = "accept_prob"

    if "clv_segment_target" in merged.columns:
        merged["clv_segment"] = merged["clv_segment_target"].combine_first(merged["clv_segment"])

    output_cols = [
        "customer_id", "list_type", "recommended_action",
        "churn_prob", "churn_risk_band", "accept_prob", "crosssell_prob_band",
        "clv_segment", "risk_segment", "age", "gender", "marital_status",
        "education_level", "occupation", "city_tier", "region", "annual_income",
        "account_type", "tenure_months", "credit_score", "account_balance",
        "num_products_held", "avg_monthly_transactions", "avg_transaction_value",
        "digital_channel_usage_pct", "missed_payments_6m", "branch_visits_monthly",
        "customer_service_calls_6m", "complaint_raised", "nps_score",
        "campaigns_sent_12m", "campaigns_opened_12m", "campaigns_clicked_12m",
        "preferred_campaign_channel", "last_campaign_type", "days_since_last_campaign",
        "campaign_offer_category", "clv_score", "churned", "cross_sell_accepted",
    ]
    return merged.sort_values(sort_col, ascending=False)[output_cols].head(1000)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5001))
    debug = os.environ.get("FLASK_DEBUG", "0") == "1"
    app.run(host="0.0.0.0", port=port, debug=debug)
