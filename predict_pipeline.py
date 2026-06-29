import json
import os
import joblib
import numpy as np
import pandas as pd
from sklearn.base import BaseEstimator, TransformerMixin
from sklearn.pipeline import Pipeline

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODELS_DIR = os.path.join(BASE_DIR, "models")

_ASSETS = None

DROP_COLS = [
    "customer_id",
    "clv_segment",
    "risk_segment",
    "internet_banking_logins_monthly",
    "mobile_app_logins_monthly",
    "churned",
    "cross_sell_accepted",
    "churn_prob",
    "churn_flag",
    "churn_risk_band",
    "accept_prob",
    "crosssell_flag",
    "crosssell_prob_band",
]

ENGINEERED_FEATURES = [
    "risk_indicator",
    "complaint_nps_interaction",
]

PRODUCT_FLAG_COLS = [
    "has_credit_card",
    "has_personal_loan",
    "has_home_loan",
    "has_investment_account",
    "has_insurance_product",
]

DEFAULT_CONFIG = {
    "churn_threshold": 0.19264529058116234,
    "crosssell_threshold": 0.33993987975951906,
    "risk_band_edges": [0.0, 0.0943, 0.1570, 1.0],
    "crosssell_band_edges": [0.0, 0.2418, 0.3268, 1.0],
}


class FeatureEngineeringTransformer(BaseEstimator, TransformerMixin):
    def fit(self, X, y=None):
        return self

    def transform(self, X):
        return engineer_features(X)


def load_assets():
    global _ASSETS
    if _ASSETS is not None:
        return _ASSETS

    config = DEFAULT_CONFIG.copy()
    config_path = os.path.join(MODELS_DIR, "pipeline_config.json")
    if os.path.exists(config_path):
        with open(config_path, "r", encoding="utf-8") as f:
            config.update(json.load(f))

    churn_prep = joblib.load(os.path.join(MODELS_DIR, "churn_preprocessor.pkl"))
    cs_prep = joblib.load(os.path.join(MODELS_DIR, "cs_preprocessor.pkl"))
    churn_model = joblib.load(os.path.join(MODELS_DIR, "churn_model.pkl"))
    cs_model = joblib.load(os.path.join(MODELS_DIR, "cs_model.pkl"))

    churn_pipe_path = os.path.join(MODELS_DIR, "churn_pipeline.pkl")
    cs_pipe_path = os.path.join(MODELS_DIR, "cs_pipeline.pkl")

    churn_pipeline = joblib.load(churn_pipe_path) if os.path.exists(churn_pipe_path) else None
    cs_pipeline = joblib.load(cs_pipe_path) if os.path.exists(cs_pipe_path) else None

    _ASSETS = {
        "config": config,
        "churn_prep": churn_prep,
        "cs_prep": cs_prep,
        "churn_model": churn_model,
        "cs_model": cs_model,
        "churn_pipeline": churn_pipeline,
        "cs_pipeline": cs_pipeline,
        "churn_features": _extract_feature_names(churn_prep),
        "cs_features": _extract_feature_names(cs_prep),
        "churn_coefs": _extract_coefficients(churn_model),
        "cs_coefs": _extract_coefficients(cs_model),
    }
    return _ASSETS


def build_integrated_pipelines():
    assets = load_assets()

    if assets["churn_pipeline"] is None:
        assets["churn_pipeline"] = Pipeline([
            ("feature_engineering", FeatureEngineeringTransformer()),
            ("preprocessor", assets["churn_prep"]),
            ("model", assets["churn_model"]),
        ])
        joblib.dump(assets["churn_pipeline"], os.path.join(MODELS_DIR, "churn_pipeline.pkl"))

    if assets["cs_pipeline"] is None:
        assets["cs_pipeline"] = Pipeline([
            ("feature_engineering", FeatureEngineeringTransformer()),
            ("preprocessor", assets["cs_prep"]),
            ("model", assets["cs_model"]),
        ])
        joblib.dump(assets["cs_pipeline"], os.path.join(MODELS_DIR, "cs_pipeline.pkl"))


def _extract_feature_names(preprocessor):
    num_cols = preprocessor.transformers_[0][2]
    ord_cols = preprocessor.transformers_[1][2]
    nom_cols = preprocessor.transformers_[2][2]
    encoder = preprocessor.named_transformers_["nom"]["encode"]
    nom_names = encoder.get_feature_names_out(nom_cols).tolist()
    return num_cols + ord_cols + nom_names


def _extract_coefficients(calibrated_model):
    coefs = []
    for classifier in calibrated_model.calibrated_classifiers_:
        estimator = getattr(classifier, "estimator", None) or getattr(classifier, "base_estimator", None)
        if estimator is not None and hasattr(estimator, "coef_"):
            coefs.append(estimator.coef_[0])
    return np.mean(coefs, axis=0) if coefs else None


def expected_input_columns():
    assets = load_assets()
    return _expected_raw_features(assets["churn_prep"])


def _expected_raw_features(preprocessor):
    features = []
    for _, _, cols in preprocessor.transformers_:
        features.extend(list(cols))
    return [col for col in features if col not in ENGINEERED_FEATURES]


def _prepare_raw_features(df_raw, preprocessor):
    df = df_raw.copy()
    df = df.drop(columns=[c for c in DROP_COLS if c in df.columns], errors="ignore")
    df = normalize_product_count(df)

    expected_cols = _expected_raw_features(preprocessor)
    missing = [col for col in expected_cols if col not in df.columns]
    if missing:
        raise ValueError(f"Missing required input feature(s): {', '.join(missing)}")
    return df[expected_cols]


def normalize_product_count(df_in):
    df_out = df_in.copy()
    if all(col in df_out.columns for col in PRODUCT_FLAG_COLS):
        flags = df_out[PRODUCT_FLAG_COLS].apply(pd.to_numeric, errors="coerce").fillna(0)
        flags = flags.clip(lower=0, upper=1)
        df_out["num_products_held"] = 1 + flags.sum(axis=1).astype(int)
    return df_out


def engineer_features(df_in):
    df_out = df_in.copy()
    nps_filled = df_out["nps_score"].fillna(df_out["nps_score"].median())
    df_out["risk_indicator"] = df_out["missed_payments_6m"] + df_out["complaint_raised"]
    df_out["complaint_nps_interaction"] = (10 - nps_filled) * (df_out["complaint_raised"] + 1)
    return df_out


def score_dataframe(df_raw):
    assets = load_assets()
    cfg = assets["config"]
    churn_threshold = float(cfg["churn_threshold"])
    crosssell_threshold = float(cfg["crosssell_threshold"])

    df_scored = df_raw.copy()
    raw_churn = _prepare_raw_features(df_raw, assets["churn_prep"])
    raw_cs = _prepare_raw_features(df_raw, assets["cs_prep"])

    if assets["churn_pipeline"] is not None:
        df_scored["churn_prob"] = assets["churn_pipeline"].predict_proba(raw_churn)[:, 1]
    else:
        X_churn = assets["churn_prep"].transform(engineer_features(raw_churn))
        df_scored["churn_prob"] = assets["churn_model"].predict_proba(X_churn)[:, 1]

    df_scored["churn_flag"] = (df_scored["churn_prob"] >= churn_threshold).astype(int)
    df_scored["churn_risk_band"] = pd.cut(
        df_scored["churn_prob"].clip(0, 1),
        bins=cfg.get("risk_band_edges", DEFAULT_CONFIG["risk_band_edges"]),
        labels=["Low Risk", "Medium Risk", "High Risk"],
        include_lowest=True,
    ).astype(str)

    if assets["cs_pipeline"] is not None:
        df_scored["accept_prob"] = assets["cs_pipeline"].predict_proba(raw_cs)[:, 1]
    else:
        X_cs = assets["cs_prep"].transform(engineer_features(raw_cs))
        df_scored["accept_prob"] = assets["cs_model"].predict_proba(X_cs)[:, 1]

    df_scored.loc[df_scored["churn_flag"] == 1, "accept_prob"] = 0.0
    df_scored["crosssell_flag"] = (df_scored["accept_prob"] >= crosssell_threshold).astype(int)
    df_scored["crosssell_prob_band"] = pd.cut(
        df_scored["accept_prob"].clip(0, 1),
        bins=cfg.get("crosssell_band_edges", DEFAULT_CONFIG["crosssell_band_edges"]),
        labels=["Low Probability", "Medium Probability", "High Probability"],
        include_lowest=True,
    ).astype(str)

    return df_scored


def explain_customer(customer_row, top_n=4):
    assets = load_assets()
    df_single = pd.DataFrame([customer_row])
    return {
        "churn": _explain(df_single, assets["churn_prep"], assets["churn_coefs"], assets["churn_features"], top_n),
        "crosssell": _explain(df_single, assets["cs_prep"], assets["cs_coefs"], assets["cs_features"], top_n),
    }


def _explain(df_single, preprocessor, coefs, feature_names, top_n):
    if coefs is None:
        return []
    raw = _prepare_raw_features(df_single, preprocessor)
    prepared = preprocessor.transform(engineer_features(raw))[0]
    contributions = prepared * coefs

    rows = []
    for name, contribution in zip(feature_names, contributions):
        rows.append({
            "display_name": name.replace("_", " ").title(),
            "contribution": float(contribution),
            "importance": float(abs(contribution)),
        })
    return sorted(rows, key=lambda item: item["importance"], reverse=True)[:top_n]
