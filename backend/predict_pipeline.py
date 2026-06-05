import os
import joblib
import json
import pandas as pd
import numpy as np
from sklearn.pipeline import Pipeline
from sklearn.base import BaseEstimator, TransformerMixin

# Resolve paths relative to this script
BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
FINAL_DIR = os.path.dirname(BACKEND_DIR)
MODELS_DIR = os.path.join(FINAL_DIR, 'models')

# Global variables for models and configs
_ASSETS = None

DROP_COLS = [
    'customer_id',
    'clv_segment',
    'risk_segment',
    'internet_banking_logins_monthly',
    'mobile_app_logins_monthly',
    'churned',
    'cross_sell_accepted',
    'churn_prob',
    'churn_flag',
    'churn_risk_band',
    'accept_prob',
    'crosssell_flag',
    'crosssell_prob_band',
]

ENGINEERED_FEATURES = [
    'campaign_open_rate',
    'balance_income_ratio',
    'savings_efficiency',
    'risk_indicator',
    'monthly_txn_volume',
    'complaint_nps_interaction',
    'products_per_tenure',
]

DEFAULT_CONFIG = {
    "churn_threshold": 0.19068136272545091,
    "crosssell_threshold": 0.33993987975951906,
    "churn_capacity_pct": 0.25,
    "cs_capacity_pct": 0.30,
    "clv_multiplier": 0.5,
    "base_value_saved": 100,
    "revenue_per_accept": 200,
    "cost_contact": 5,
    "retention_save_rate": 0.40,
    "risk_band_edges": [0.0, 0.0943, 0.1570, 1.0],
    "crosssell_band_edges": [0.0, 0.2418, 0.3268, 1.0],
}


class FeatureEngineeringTransformer(BaseEstimator, TransformerMixin):
    """Scikit-learn transformer for project feature engineering."""

    def fit(self, X, y=None):
        return self

    def transform(self, X):
        return engineer_features(X)

def load_assets():
    """Loads all models, preprocessors, thresholds, and extracts feature weights."""
    global _ASSETS
    if _ASSETS is not None:
        return _ASSETS

    churn_model_path = os.path.join(MODELS_DIR, 'churn_model.pkl')
    churn_prep_path = os.path.join(MODELS_DIR, 'churn_preprocessor.pkl')
    churn_pipe_path = os.path.join(MODELS_DIR, 'churn_pipeline.pkl')
    cs_model_path = os.path.join(MODELS_DIR, 'cs_model.pkl')
    cs_prep_path = os.path.join(MODELS_DIR, 'cs_preprocessor.pkl')
    cs_pipe_path = os.path.join(MODELS_DIR, 'cs_pipeline.pkl')
    config_path = os.path.join(MODELS_DIR, 'pipeline_config.json')

    churn_model = joblib.load(churn_model_path)
    churn_prep = joblib.load(churn_prep_path)
    cs_model = joblib.load(cs_model_path)
    cs_prep = joblib.load(cs_prep_path)
    churn_pipeline = joblib.load(churn_pipe_path) if os.path.exists(churn_pipe_path) else None
    cs_pipeline = joblib.load(cs_pipe_path) if os.path.exists(cs_pipe_path) else None

    config = DEFAULT_CONFIG.copy()
    if os.path.exists(config_path):
        with open(config_path) as f:
            config.update(json.load(f))

    # Extract feature names
    churn_features = _extract_feature_names(churn_prep)
    cs_features = _extract_feature_names(cs_prep)

    # Extract average coefficients from CalibratedClassifierCV
    churn_coefs = _extract_coefficients(churn_model)
    cs_coefs = _extract_coefficients(cs_model)

    _ASSETS = {
        'churn_model': churn_model,
        'churn_prep': churn_prep,
        'churn_pipeline': churn_pipeline,
        'cs_model': cs_model,
        'cs_prep': cs_prep,
        'cs_pipeline': cs_pipeline,
        'config': config,
        'churn_features': churn_features,
        'cs_features': cs_features,
        'churn_coefs': churn_coefs,
        'cs_coefs': cs_coefs
    }
    return _ASSETS

def _extract_feature_names(prep):
    num_cols = prep.transformers_[0][2]
    ord_cols = prep.transformers_[1][2]
    nom_cols = prep.transformers_[2][2]
    ohe = prep.named_transformers_['nom']['encode']
    ohe_names = ohe.get_feature_names_out(nom_cols).tolist()
    return num_cols + ord_cols + ohe_names

def _extract_coefficients(calibrated_model):
    coefs = []
    for classifier in calibrated_model.calibrated_classifiers_:
        estimator = getattr(classifier, 'estimator', None) or getattr(classifier, 'base_estimator', None)
        if estimator is not None and hasattr(estimator, 'coef_'):
            coefs.append(estimator.coef_[0])
    if not coefs:
        return None
    return np.mean(coefs, axis=0)

def _expected_raw_features(prep):
    features = []
    for _, _, cols in prep.transformers_:
        features.extend(list(cols))
    return [col for col in features if col not in ENGINEERED_FEATURES]

def _prepare_raw_features(df_raw, prep):
    df = df_raw.copy()
    df = df.drop(columns=[c for c in DROP_COLS if c in df.columns], errors='ignore')
    expected_cols = _expected_raw_features(prep)
    missing = [col for col in expected_cols if col not in df.columns]
    if missing:
        raise ValueError(f"Missing required input feature(s): {', '.join(missing)}")
    return df[expected_cols]

def engineer_features(df_in):
    """Applies the same feature engineering logic as the training pipeline."""
    df_out = df_in.copy()
    
    # Feature engineering formulas
    df_out['campaign_open_rate']        = df_out['campaigns_opened_12m'] / (df_out['campaigns_sent_12m'] + 1)
    df_out['balance_income_ratio']      = df_out['account_balance'] / (df_out['annual_income'] + 1)
    df_out['savings_efficiency']        = df_out['account_balance'] / (df_out['avg_monthly_transactions'] + 1)
    df_out['risk_indicator']            = df_out['missed_payments_6m'] + df_out['complaint_raised']
    df_out['monthly_txn_volume']        = df_out['avg_monthly_transactions'] * df_out['avg_transaction_value']
    
    nps_filled = df_out['nps_score'].fillna(df_out['nps_score'].median())
    df_out['complaint_nps_interaction'] = (10 - nps_filled) * (df_out['complaint_raised'] + 1)
    df_out['products_per_tenure']       = df_out['num_products_held'] / (df_out['tenure_months'] / 12 + 1)
    
    return df_out

def build_integrated_pipelines(overwrite=False):
    """Build raw-input sklearn pipelines from the saved preprocessors and models."""
    assets = load_assets()
    paths = {
        'churn_pipeline': os.path.join(MODELS_DIR, 'churn_pipeline.pkl'),
        'cs_pipeline': os.path.join(MODELS_DIR, 'cs_pipeline.pkl'),
    }

    if overwrite or not os.path.exists(paths['churn_pipeline']):
        churn_pipeline = Pipeline([
            ('feature_engineering', FeatureEngineeringTransformer()),
            ('preprocessor', assets['churn_prep']),
            ('model', assets['churn_model']),
        ])
        joblib.dump(churn_pipeline, paths['churn_pipeline'])
        assets['churn_pipeline'] = churn_pipeline

    if overwrite or not os.path.exists(paths['cs_pipeline']):
        cs_pipeline = Pipeline([
            ('feature_engineering', FeatureEngineeringTransformer()),
            ('preprocessor', assets['cs_prep']),
            ('model', assets['cs_model']),
        ])
        joblib.dump(cs_pipeline, paths['cs_pipeline'])
        assets['cs_pipeline'] = cs_pipeline

    return paths

def score_dataframe(df_raw, custom_thresholds=None):
    """Scores a dataframe of raw customers. Returns dataframe with predictions."""
    assets = load_assets()
    cfg = assets['config']
    
    churn_thresh = float(custom_thresholds.get('churn_threshold', cfg['churn_threshold'])) if custom_thresholds else float(cfg['churn_threshold'])
    cs_thresh = float(custom_thresholds.get('crosssell_threshold', cfg['crosssell_threshold'])) if custom_thresholds else float(cfg['crosssell_threshold'])
    
    df_scored = df_raw.copy()
    raw_churn = _prepare_raw_features(df_raw, assets['churn_prep'])
    raw_cs = _prepare_raw_features(df_raw, assets['cs_prep'])
    
    if assets.get('churn_pipeline') is not None:
        df_scored['churn_prob'] = assets['churn_pipeline'].predict_proba(raw_churn)[:, 1]
    else:
        df_feat = engineer_features(raw_churn)
        X_churn = assets['churn_prep'].transform(df_feat)
        df_scored['churn_prob'] = assets['churn_model'].predict_proba(X_churn)[:, 1]
    df_scored['churn_flag'] = (df_scored['churn_prob'] >= churn_thresh).astype(int)
    
    risk_edges = cfg.get('risk_band_edges', DEFAULT_CONFIG['risk_band_edges'])
    df_scored['churn_risk_band'] = pd.cut(
        df_scored['churn_prob'].clip(0, 1),
        bins=risk_edges,
        labels=['Low Risk', 'Medium Risk', 'High Risk'],
        include_lowest=True
    ).astype(str)
    
    if assets.get('cs_pipeline') is not None:
        df_scored['accept_prob'] = assets['cs_pipeline'].predict_proba(raw_cs)[:, 1]
    else:
        df_feat = engineer_features(raw_cs)
        X_cs = assets['cs_prep'].transform(df_feat)
        df_scored['accept_prob'] = assets['cs_model'].predict_proba(X_cs)[:, 1]
    
    df_scored.loc[df_scored['churn_flag'] == 1, 'accept_prob'] = 0.0
    df_scored['crosssell_flag'] = (df_scored['accept_prob'] >= cs_thresh).astype(int)
    cs_band_edges = cfg.get('crosssell_band_edges', DEFAULT_CONFIG['crosssell_band_edges'])
    df_scored['crosssell_prob_band'] = pd.cut(
        df_scored['accept_prob'].clip(0, 1),
        bins=cs_band_edges,
        labels=['Low Probability', 'Medium Probability', 'High Probability'],
        include_lowest=True
    ).astype(str)
    
    return df_scored

def explain_customer(customer_row_dict):
    """Calculates local feature contributions (similar to SHAP) for a single customer."""
    assets = load_assets()
    
    df_single = pd.DataFrame([customer_row_dict])
    df_raw = _prepare_raw_features(df_single, assets['churn_prep'])
    df_feat = engineer_features(df_raw)
    
    X_prep = assets['churn_prep'].transform(df_feat)[0]
    coefs = assets['churn_coefs']
    if coefs is None:
        return {'drivers': [], 'restrainers': []}
    feature_names = assets['churn_features']
    
    contributions = X_prep * coefs
    
    # We want to identify the features with the largest positive and negative impact
    contrib_list = []
    for name, contrib in zip(feature_names, contributions):
        display_name = name.replace('_', ' ').title()
        contrib_list.append({
            'feature': name,
            'display_name': display_name,
            'contribution': float(contrib),
            'importance': float(abs(contrib))
        })
        
    # Sort by contribution magnitude
    contrib_list = sorted(contrib_list, key=lambda x: x['contribution'], reverse=True)
    
    # Split into positive churn drivers and negative churn restrainers
    drivers = [c for c in contrib_list if c['contribution'] > 0][:5]
    restrainers = [c for c in contrib_list if c['contribution'] <= 0][-5:]
    # Reverse restrainers so strongest is first in its list
    restrainers = sorted(restrainers, key=lambda x: x['contribution'])[:5]
    
    return {
        'drivers': drivers,
        'restrainers': restrainers
    }
