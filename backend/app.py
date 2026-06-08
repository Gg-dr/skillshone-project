import os
import uuid
import pandas as pd
import numpy as np
from flask import Flask, jsonify, request, send_from_directory, send_file
from werkzeug.utils import secure_filename

import predict_pipeline

app = Flask(__name__, static_folder='../static', static_url_path='')

CUSTOMER_DB = None
RAW_DATA_PATH = None

def load_and_initialize_db():
    """Loads raw data, runs ML scoring pipeline, and caches in memory."""
    global CUSTOMER_DB, RAW_DATA_PATH
    
    backend_dir = os.path.dirname(os.path.abspath(__file__))
    final_dir = os.path.dirname(backend_dir)
    parent_dir = os.path.dirname(final_dir)
    
    paths_to_try = [
        os.path.join(parent_dir, 'finance_marketing_01.csv'),
        os.path.join(final_dir, 'finance_marketing_01.csv'),
        'finance_marketing_01.csv'
    ]
    
    for path in paths_to_try:
        if os.path.exists(path):
            RAW_DATA_PATH = path
            break
            
    if not RAW_DATA_PATH:
        print("WARNING: finance_marketing_01.csv not found! Dashboard stats will be empty.")
        CUSTOMER_DB = pd.DataFrame()
        return

    print(f"Loading customer database from: {RAW_DATA_PATH}")
    df_raw = pd.read_csv(RAW_DATA_PATH)
    
    # Pre-score database on startup
    print("Running initial scoring pipeline...")
    try:
        predict_pipeline.load_assets()
        predict_pipeline.build_integrated_pipelines()
        CUSTOMER_DB = predict_pipeline.score_dataframe(df_raw)
        print(f"Loaded and scored {len(CUSTOMER_DB):,} customer records successfully.")
    except Exception as e:
        print(f"ERROR scoring database: {e}")
        CUSTOMER_DB = df_raw # fallback to raw

TEMP_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'temp_downloads')
os.makedirs(TEMP_DIR, exist_ok=True)

# Ensure database is loaded
load_and_initialize_db()

@app.route('/')
def serve_index():
    return app.send_static_file('index.html')

@app.route('/api/summary')
def get_summary():
    """Returns high-level KPI cards and chart data for the dashboard."""
    if CUSTOMER_DB.empty:
        return jsonify({'error': 'No data loaded'}), 404
        
    cfg = predict_pipeline.load_assets()['config']
    cost_contact = request.args.get('cost_contact', default=float(cfg['cost_contact']), type=float)
    base_value_saved = request.args.get('base_value_saved', default=float(cfg['base_value_saved']), type=float)
    revenue_per_accept = request.args.get('revenue_per_accept', default=float(cfg['revenue_per_accept']), type=float)
    
    total = len(CUSTOMER_DB)

    has_actual = 'churned' in CUSTOMER_DB.columns
    actual_churn_rate = float(CUSTOMER_DB['churned'].mean()) if has_actual else 0.0
    actual_cs_rate = float(CUSTOMER_DB['cross_sell_accepted'].mean()) if 'cross_sell_accepted' in CUSTOMER_DB.columns else 0.0
    
    pred_churn_rate = float(CUSTOMER_DB['churn_prob'].mean())
    pred_cs_rate = float(CUSTOMER_DB['accept_prob'].mean())
    targeted_churn_rate = float(CUSTOMER_DB['churn_flag'].mean())
    targeted_cs_rate = float(CUSTOMER_DB['crosssell_flag'].mean())
    

    churn_flags = CUSTOMER_DB['churn_flag']
    churn_probs = CUSTOMER_DB['churn_prob']
    
    customer_saved_value = base_value_saved + (CUSTOMER_DB.get('clv_score', 0) * float(cfg.get('clv_multiplier', 0.5)))
    expected_churners_reached = float((churn_probs * churn_flags).sum())
    expected_retention_revenue = float((churn_probs * churn_flags * customer_saved_value).sum())
    retention_cost = float(churn_flags.sum() * cost_contact)
    backtest_retention_revenue = None
    if has_actual:
        true_churn_target_mask = (churn_flags == 1) & (CUSTOMER_DB['churned'] == 1)
        backtest_retention_revenue = float(customer_saved_value[true_churn_target_mask].sum())

    retention_revenue = backtest_retention_revenue if backtest_retention_revenue is not None else expected_retention_revenue
    retention_net = retention_revenue - retention_cost
    
    cs_flags = CUSTOMER_DB['crosssell_flag']
    cs_probs = CUSTOMER_DB['accept_prob']
    expected_cs_accepts = float((cs_probs * cs_flags).sum())
    expected_cs_revenue = expected_cs_accepts * revenue_per_accept
    cs_cost = float(cs_flags.sum() * cost_contact)
    backtest_cs_revenue = None
    if 'cross_sell_accepted' in CUSTOMER_DB.columns:
        true_accept_target_mask = (cs_flags == 1) & (CUSTOMER_DB['cross_sell_accepted'] == 1)
        backtest_cs_revenue = float(true_accept_target_mask.sum() * revenue_per_accept)

    cs_revenue = backtest_cs_revenue if backtest_cs_revenue is not None else expected_cs_revenue
    cs_net = cs_revenue - cs_cost
    profit_mode = 'backtest' if backtest_retention_revenue is not None and backtest_cs_revenue is not None else 'expected'
    
    # Totals
    total_revenue = retention_revenue + cs_revenue
    total_cost = retention_cost + cs_cost
    total_net = total_revenue - total_cost
    
    # Risk band distribution
    risk_counts = CUSTOMER_DB['churn_risk_band'].value_counts().to_dict()
    crosssell_band_counts = CUSTOMER_DB['crosssell_prob_band'].value_counts().to_dict() if 'crosssell_prob_band' in CUSTOMER_DB.columns else {}
    # CLV segment distribution
    clv_col = 'clv_segment' if 'clv_segment' in CUSTOMER_DB.columns else 'clv_score'
    if clv_col == 'clv_segment':
        clv_counts = CUSTOMER_DB['clv_segment'].value_counts().to_dict()
    else:
        clv_bins = pd.cut(CUSTOMER_DB['clv_score'], bins=[0, 300, 600, 800, 10000], labels=['Low', 'Medium', 'High', 'Premium'])
        clv_counts = clv_bins.value_counts().to_dict()
        
    channel_effectiveness = {}
    if 'preferred_campaign_channel' in CUSTOMER_DB.columns:
        channels = CUSTOMER_DB.groupby('preferred_campaign_channel')
        for name, group in channels:
            channel_effectiveness[str(name)] = {
                'avg_churn_prob': float(group['churn_prob'].mean()),
                'avg_accept_prob': float(group['accept_prob'].mean()),
                'count': int(len(group))
            }

    return jsonify({
        'total_customers': total,
        'actual_churn_rate': actual_churn_rate,
        'actual_crosssell_rate': actual_cs_rate,
        'pred_churn_rate': pred_churn_rate,
        'pred_crosssell_rate': pred_cs_rate,
        'targeted_churn_rate': targeted_churn_rate,
        'targeted_crosssell_rate': targeted_cs_rate,
        'risk_band_counts': risk_counts,
        'crosssell_band_counts': crosssell_band_counts,
        'clv_segment_counts': clv_counts,
        'channel_effectiveness': channel_effectiveness,
        'config': {
            'churn_threshold': float(cfg['churn_threshold']),
            'crosssell_threshold': float(cfg['crosssell_threshold']),
            'cost_contact': float(cfg['cost_contact']),
            'base_value_saved': float(cfg['base_value_saved']),
            'revenue_per_accept': float(cfg['revenue_per_accept']),
            'churn_capacity_pct': float(cfg.get('churn_capacity_pct', 0.25)),
            'cs_capacity_pct': float(cfg.get('cs_capacity_pct', 0.30)),
        },
        'financials': {
            'retention_contacts': int(churn_flags.sum()),
            'expected_churners_reached': expected_churners_reached,
            'retention_cost': retention_cost,
            'retention_revenue': retention_revenue,
            'expected_retention_revenue': expected_retention_revenue,
            'retention_net': retention_net,
            'crosssell_contacts': int(cs_flags.sum()),
            'expected_crosssell_accepts': expected_cs_accepts,
            'crosssell_cost': cs_cost,
            'crosssell_revenue': cs_revenue,
            'expected_crosssell_revenue': expected_cs_revenue,
            'crosssell_net': cs_net,
            'total_cost': total_cost,
            'total_revenue': total_revenue,
            'total_net': total_net,
            'profit_mode': profit_mode
        }
    })

@app.route('/api/customers')
def get_customers():
    """Paginated list of customers with search and filters."""
    if CUSTOMER_DB.empty:
        return jsonify({'customers': [], 'total': 0})
        
    page = request.args.get('page', default=1, type=int)
    limit = request.args.get('limit', default=15, type=int)
    search = request.args.get('search', default='', type=str).strip().lower()
    risk_band = request.args.get('risk_band', default='', type=str)
    clv_segment = request.args.get('clv_segment', default='', type=str)
    
    df = CUSTOMER_DB.copy()
    
    if search:
        df = df[df['customer_id'].astype(str).str.lower().str.contains(search)]
    if risk_band:
        df = df[df['churn_risk_band'] == risk_band]
    if clv_segment and 'clv_segment' in df.columns:
        df = df[df['clv_segment'] == clv_segment]
        
    total = len(df)
    start_idx = (page - 1) * limit
    end_idx = start_idx + limit
    
    cols = ['customer_id', 'age', 'gender', 'annual_income', 'churn_prob', 'churn_risk_band', 'accept_prob', 'crosssell_prob_band']
    if 'clv_segment' in df.columns:
        cols.append('clv_segment')
        
    page_df = df.iloc[start_idx:end_idx]
    customers_list = page_df[cols].to_dict(orient='records')
    
    pages = (total + limit - 1) // limit
    
    return jsonify({
        'customers': customers_list,
        'total': total,
        'page': page,
        'pages': pages,
        'limit': limit
    })

@app.route('/api/customer/<customer_id>')
def get_customer_details(customer_id):
    """Returns detailed features, predictions, and drivers for a single customer."""
    if CUSTOMER_DB.empty:
        return jsonify({'error': 'No database loaded'}), 404
        
    match = CUSTOMER_DB[CUSTOMER_DB['customer_id'] == customer_id]
    if match.empty:
        return jsonify({'error': f"Customer {customer_id} not found"}), 404
        
    customer_dict = match.iloc[0].to_dict()
    
    for k, v in list(customer_dict.items()):
        if pd.isna(v):
            customer_dict[k] = None
        elif isinstance(v, (np.integer, np.floating)):
            customer_dict[k] = v.item()
            
    try:
        contributions = predict_pipeline.explain_customer(customer_dict)
    except Exception as e:
        print(f"Error explaining customer: {e}")
        contributions = {'drivers': [], 'restrainers': []}
        
    return jsonify({
        'details': customer_dict,
        'contributions': contributions
    })

@app.route('/api/priority/retention')
def get_priority_retention():
    """Returns top 1000 active customers sorted by churn probability."""
    if CUSTOMER_DB.empty:
        return jsonify([])
        
    active_df = CUSTOMER_DB[CUSTOMER_DB['churned'] == 0] if 'churned' in CUSTOMER_DB.columns else CUSTOMER_DB
    
    priority = active_df.sort_values('churn_prob', ascending=False).head(1000)
    
    cols = ['customer_id', 'churn_prob', 'churn_risk_band', 'clv_segment']
    cols = [c for c in cols if c in priority.columns]
    
    result = priority[cols].to_dict(orient='records')
    return jsonify(result)

@app.route('/api/priority/crosssell')
def get_priority_crosssell():
    """Returns top 1000 active, non-churning customers sorted by cross-sell probability."""
    if CUSTOMER_DB.empty:
        return jsonify([])
        
    active_non_churn = CUSTOMER_DB[(CUSTOMER_DB['churn_flag'] == 0)]
    if 'churned' in active_non_churn.columns:
        active_non_churn = active_non_churn[active_non_churn['churned'] == 0]
        
    priority = active_non_churn.sort_values('accept_prob', ascending=False).head(1000)
    
    cols = ['customer_id', 'accept_prob', 'crosssell_prob_band', 'clv_segment']
    cols = [c for c in cols if c in priority.columns]
    
    result = priority[cols].to_dict(orient='records')
    return jsonify(result)

@app.route('/api/predict', methods=['POST'])
def predict_single():
    """Endpoint for sandbox what-if scoring."""
    input_data = request.json
    if not input_data:
        return jsonify({'error': 'No input data provided'}), 400
        
    custom_thresholds = {
        'churn_threshold': input_data.get('custom_churn_threshold'),
        'crosssell_threshold': input_data.get('custom_crosssell_threshold')
    }
    custom_thresholds = {k: v for k, v in custom_thresholds.items() if v is not None}
    
    try:
        df_scored = predict_pipeline.score_dataframe(pd.DataFrame([input_data]), custom_thresholds)
        scored_dict = df_scored.iloc[0].to_dict()
        
        for k, v in list(scored_dict.items()):
            if pd.isna(v):
                scored_dict[k] = None
            elif isinstance(v, (np.integer, np.floating)):
                scored_dict[k] = v.item()
                
        contributions = predict_pipeline.explain_customer(scored_dict)
        
        return jsonify({
            'predictions': scored_dict,
            'contributions': contributions
        })
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route('/api/upload', methods=['POST'])
def upload_file():
    """Handles CSV upload, scores it, saves scored copy, and returns scoring statistics."""
    if 'file' not in request.files:
        return jsonify({'error': 'No file uploaded'}), 400
        
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'No file selected'}), 400
        
    if not file.filename.endswith('.csv'):
        return jsonify({'error': 'Please upload a CSV file'}), 400
        
    try:
        df_uploaded = pd.read_csv(file)
        
        required_sample = predict_pipeline._expected_raw_features(predict_pipeline.load_assets()['churn_prep'])
        missing = [col for col in required_sample if col not in df_uploaded.columns]
        if missing:
            return jsonify({'error': f"Uploaded CSV is missing critical features: {', '.join(missing)}"}), 400
            
        custom_thresholds = {}
        churn_t = request.form.get('churn_threshold')
        cs_t = request.form.get('crosssell_threshold')
        if churn_t is not None:
            custom_thresholds['churn_threshold'] = float(churn_t)
        if cs_t is not None:
            custom_thresholds['crosssell_threshold'] = float(cs_t)
            
        df_scored = predict_pipeline.score_dataframe(df_uploaded, custom_thresholds)
        
        file_key = str(uuid.uuid4())
        save_path = os.path.join(TEMP_DIR, f"{file_key}.csv")
        df_scored.to_csv(save_path, index=False)
        
        total_rows = len(df_scored)
        churn_flags = int(df_scored['churn_flag'].sum())
        cs_flags = int(df_scored['crosssell_flag'].sum())
        
        risk_counts = df_scored['churn_risk_band'].value_counts().to_dict()
        
        # Preview first 5 rows
        preview_cols = ['customer_id', 'churn_prob', 'churn_risk_band', 'accept_prob', 'crosssell_prob_band', 'crosssell_flag']
        preview_cols = [c for c in preview_cols if c in df_scored.columns]
        preview_data = df_scored[preview_cols].head(5).to_dict(orient='records')
        
        for row in preview_data:
            for k, v in list(row.items()):
                if pd.isna(v):
                    row[k] = None
                elif isinstance(v, (np.integer, np.floating)):
                    row[k] = v.item()

        return jsonify({
            'file_key': file_key,
            'filename': f"scored_{file.filename}",
            'stats': {
                'total_rows': total_rows,
                'churn_flags': churn_flags,
                'churn_rate': float(df_scored['churn_flag'].mean()),
                'crosssell_flags': cs_flags,
                'crosssell_rate': float(df_scored['crosssell_flag'].mean()),
                'risk_band_counts': risk_counts
            },
            'preview': preview_data
        })
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'error': f"Error scoring file: {str(e)}"}), 500

@app.route('/api/download/<file_key>')
def download_scored_file(file_key):
    """Downloads the scored CSV matching the file key."""
    safe_key = secure_filename(f"{file_key}.csv")
    file_path = os.path.join(TEMP_DIR, safe_key)
    
    if not os.path.exists(file_path):
        return jsonify({'error': 'File not found or link expired'}), 404
        
    return send_file(file_path, as_attachment=True, download_name="scored_customers_output.csv")

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5001, debug=True)
