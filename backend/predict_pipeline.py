import os
import joblib
import json
import pandas as pd
import numpy as np
from sklearn.pipeline import Pipeline
from sklearn.base import BaseEstimator, TransformerMixin

BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
FINAL_DIR = os.path.dirname(BACKEND_DIR)
MODELS_DIR = os.path.join(FINAL_DIR, 'models')

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
    'risk_indicator',
    'complaint_nps_interaction',
]

PRODUCT_FLAG_COLS = [
    'has_credit_card',
    'has_personal_loan',
    'has_home_loan',
    'has_investment_account',
    'has_insurance_product',
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

    def fit(self, X, y=None):
        return self

    def transform(self, X):
        return engineer_features(X)

def load_assets():
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

    churn_features = _extract_feature_names(churn_prep)
    cs_features = _extract_feature_names(cs_prep)

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
    df = normalize_product_count(df)
    expected_cols = _expected_raw_features(prep)
    missing = [col for col in expected_cols if col not in df.columns]
    if missing:
        raise ValueError(f"Missing required input feature(s): {', '.join(missing)}")
    return df[expected_cols]

def normalize_product_count(df_in):
    df_out = df_in.copy()
    if all(col in df_out.columns for col in PRODUCT_FLAG_COLS):
        flags = df_out[PRODUCT_FLAG_COLS].apply(pd.to_numeric, errors='coerce').fillna(0)
        flags = flags.clip(lower=0, upper=1)
        df_out['num_products_held'] = 1 + flags.sum(axis=1).astype(int)
    return df_out

def engineer_features(df_in):
    df_out = df_in.copy()
    nps_filled = df_out['nps_score'].fillna(df_out['nps_score'].median())

    df_out['risk_indicator'] = df_out['missed_payments_6m'] + df_out['complaint_raised']
    df_out['complaint_nps_interaction'] = (10 - nps_filled) * (df_out['complaint_raised'] + 1)

    return df_out

def build_integrated_pipelines(overwrite=False):
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

def _explain_with_artifacts(df_single, prep, coefs, feature_names, top_n=4):
    if coefs is None:
        return []

    df_raw = _prepare_raw_features(df_single, prep)
    df_feat = engineer_features(df_raw)
    X_prep = prep.transform(df_feat)[0]
    contributions = X_prep * coefs

    rows = []
    for name, contrib in zip(feature_names, contributions):
        rows.append({
            'feature': name,
            'display_name': name.replace('_', ' ').title(),
            'contribution': float(contrib),
            'importance': float(abs(contrib)),
        })

    rows = sorted(rows, key=lambda item: item['importance'], reverse=True)
    return rows[:top_n]


def explain_customer(customer_row_dict):
    assets = load_assets()
    df_single = pd.DataFrame([customer_row_dict])

    churn_impacts = _explain_with_artifacts(
        df_single,
        assets['churn_prep'],
        assets['churn_coefs'],
        assets['churn_features'],
    )
    crosssell_impacts = _explain_with_artifacts(
        df_single,
        assets['cs_prep'],
        assets['cs_coefs'],
        assets['cs_features'],
    )

    return {
        'churn': churn_impacts,
        'crosssell': crosssell_impacts,
        'drivers': [item for item in churn_impacts if item['contribution'] > 0],
        'restrainers': [item for item in churn_impacts if item['contribution'] <= 0],
    }