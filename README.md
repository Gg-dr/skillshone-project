# Customer Churn and Targeted Cross-Sell Prediction for Retail Banking

## Overview

This project predicts customer churn risk and targeted cross-sell opportunity for retail banking customers. It includes a machine learning pipeline, Flask backend APIs, and a simple web dashboard for viewing results and generating predictions.

The application supports:

- Dashboard summary of churn and cross-sell results
- Single-customer prediction
- Batch CSV scoring
- Top customers for retention and cross-sell targeting

## Problem Statement

The objective is to help a retail bank identify:

- Customers likely to churn, so retention actions can be taken early
- Customers likely to accept cross-sell offers, so marketing campaigns can be targeted better

The project converts model predictions into business-friendly outputs such as risk bands, target customer lists, and profit summary.

## Dataset

Main dataset:

```text
finance_marketing_01.csv
```

The dataset contains 60,000 customer records with demographic, financial, product, transaction, service, and campaign-related features.

Target columns:

- `churned`: actual historical churn status
- `cross_sell_accepted`: actual historical cross-sell acceptance status

## Project Structure

```text
final/
├── final3.ipynb
├── featureselect.ipynb
├── finance_marketing_01.csv
├── retention_targets.csv
├── cross_sell_targets.csv
├── models/
│   ├── churn_model.pkl
│   ├── churn_preprocessor.pkl
│   ├── churn_pipeline.pkl
│   ├── cs_model.pkl
│   ├── cs_preprocessor.pkl
│   ├── cs_pipeline.pkl
│   └── pipeline_config.json
├── backend/
│   ├── app.py
│   └── predict_pipeline.py
└── static/
    ├── index.html
    ├── styles.css
    └── app.js
```

## Model Workflow

The model development is done in `final3.ipynb`.

Main steps:

1. Data loading and understanding
2. Data preprocessing
3. Feature engineering
4. Model training for churn and cross-sell prediction
5. Class imbalance handling
6. Model evaluation
7. Business threshold selection
8. Saving model and preprocessor files

## Feature Engineering

The final pipeline uses selected engineered features:

```text
risk_indicator = missed_payments_6m + complaint_raised
complaint_nps_interaction = (10 - nps_score) * (complaint_raised + 1)
```

The backend also recalculates:

```text
num_products_held = 1 base account + selected product flags
```

This keeps product count consistent with the product indicator columns.

## Model Artifacts

The notebook saves model and preprocessing files in the `models/` folder:

```text
churn_model.pkl
churn_preprocessor.pkl
cs_model.pkl
cs_preprocessor.pkl
```

The backend uses integrated pipeline files:

```text
churn_pipeline.pkl
cs_pipeline.pkl
```

These pipelines combine feature engineering, preprocessing, and model prediction.

## Backend

The backend is built using Flask.

Main files:

- `backend/app.py`: Flask application and API routes
- `backend/predict_pipeline.py`: model loading, feature engineering, scoring, and explanation logic

Important API routes:

```text
GET  /api/summary
GET  /api/priority/retention
GET  /api/priority/crosssell
GET  /api/customer/<customer_id>
POST /api/predict
POST /api/upload
GET  /api/download/<file_key>
```

The frontend sends requests to these APIs using JavaScript `fetch()`. The backend processes the request using the saved model pipelines and returns prediction results as JSON.

## Frontend

Frontend files are stored in the `static/` folder:

- `index.html`: page structure
- `styles.css`: page styling
- `app.js`: frontend logic and API calls

The frontend provides:

- Dashboard view
- Top customer lists
- Single-customer prediction form
- Batch CSV upload and scored output download

## Model Performance

Churn model test performance:

```text
Threshold: 0.1926
Precision: 33.2%
Recall:    51.1%
F1-score:  0.40
ROC-AUC:   0.7220
PR-AUC:    0.3718
Profit:    $185,866
```

Cross-sell model test performance:

```text
Threshold: 0.3399
Precision: 40.4%
Recall:    40.8%
F1-score:  0.41
ROC-AUC:   0.6301
PR-AUC:    0.3935
Profit:    $166,055
```

## Prediction Logic

For churn:

```text
churn_flag = 1 if churn_prob >= churn_threshold
```

`churn_flag = 1` means the customer is predicted as high churn risk and can be targeted for retention.

For cross-sell:

```text
crosssell_flag = 1 if accept_prob >= crosssell_threshold
```

`crosssell_flag = 1` means the customer is suitable for a cross-sell offer.

The backend prioritizes retention before cross-sell. If a customer is flagged as churn risk, cross-sell probability is set to `0.0`.

## Running the Project

From the project root:

```bash
cd final
python backend/app.py
```

Open the application in a browser:

```text
http://127.0.0.1:5001/
```

When the backend starts, it loads the saved model files and creates the integrated prediction pipelines automatically if required.

## Conclusion

This project provides an end-to-end machine learning web application for retail banking churn prediction and targeted cross-sell prediction. It connects trained ML models with a Flask backend and a simple dashboard interface for prediction, analysis, and customer targeting.