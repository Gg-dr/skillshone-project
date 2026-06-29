# Customer Churn and Targeted Cross-Sell Prediction for Retail Banking

This project is a machine learning application for retail banking. It predicts customer churn risk and cross-sell acceptance probability, then presents the results through a simple Flask backend and a clean HTML/CSS/JavaScript dashboard.

The application supports three main tasks:

- View project-level dashboard results.
- Predict churn and cross-sell outcome for a single customer.
- Upload a CSV file and score multiple customers in batch.

## Project Structure

```text
cleanfinal/
├── app.py
├── predict_pipeline.py
├── requirements.txt
├── final3_simple_readable.ipynb
├── models/
│   ├── churn_model.pkl
│   ├── cs_model.pkl
│   ├── churn_preprocessor.pkl
│   ├── cs_preprocessor.pkl
│   ├── churn_pipeline.pkl
│   ├── cs_pipeline.pkl
│   └── pipeline_config.json
├── data/
│   ├── finance_marketing_01.csv
│   ├── retention_targets.csv
│   └── cross_sell_targets.csv
└── static/
    ├── index.html
    ├── styles.css
    ├── app.js
    ├── dashboard_summary.json
    └── sample_input.csv
```

## Main Files

### `final3_simple_readable.ipynb`

This notebook contains the model development work. It includes data loading, preprocessing, feature engineering, model training, tuning, calibration, threshold optimization, SHAP analysis, segmentation, and saving the final model artifacts.

The final selected models are saved as pickle files inside the `models/` folder.

### `predict_pipeline.py`

This file is used by the backend for prediction. It loads the saved model files and preprocessors, applies the same feature engineering used during training, scores customer data, and returns churn and cross-sell predictions.

Important work done in this file:

- Loads model artifacts using `joblib`.
- Builds integrated pipelines for churn and cross-sell.
- Applies feature engineering before preprocessing.
- Normalizes `num_products_held` from product flags.
- Predicts churn probability and cross-sell acceptance probability.
- Applies saved business thresholds.
- Creates risk bands and cross-sell probability bands.
- Provides top contributing factors for single-customer prediction.

### `app.py`

This is the Flask backend. It serves the website and provides API routes used by the frontend.

Main routes:

| Route | Method | Purpose |
|---|---|---|
| `/` | GET | Opens the main web application. |
| `/api/summary` | GET | Sends dashboard summary values to the frontend. |
| `/api/customers/retention` | GET | Sends top retention customers. |
| `/api/customers/crosssell` | GET | Sends top cross-sell customers. |
| `/api/predict` | POST | Scores one customer from form input. |
| `/api/upload` | POST | Scores a batch CSV file. |
| `/api/download/<file_key>` | GET | Downloads scored batch output. |
| `/api/download/<file_key>/<list_type>` | GET | Downloads retention or cross-sell target list. |

### `static/index.html`

This file contains the page structure of the website. It defines the dashboard, customer browser, single prediction form, and batch scoring sections.

### `static/styles.css`

This file controls the complete UI design of the website, including layout, colors, cards, forms, charts, customer list, and responsive behavior.

### `static/app.js`

This file connects the frontend with the Flask backend APIs. It loads dashboard values, switches between tabs, sends prediction requests, uploads CSV files, and updates the UI with API responses.

### `static/dashboard_summary.json`

This file stores dashboard-level summary values such as total customers, actual churn rate, average predicted probabilities, financial results, model performance, model comparison, and distribution counts.

The dashboard uses this file for fixed project summary results.

## Model Artifacts

The `models/` folder contains the saved machine learning artifacts.

| File | Purpose |
|---|---|
| `churn_model.pkl` | Final trained churn model. |
| `cs_model.pkl` | Final trained cross-sell model. |
| `churn_preprocessor.pkl` | Preprocessor fitted for churn model features. |
| `cs_preprocessor.pkl` | Preprocessor fitted for cross-sell model features. |
| `churn_pipeline.pkl` | Integrated churn pipeline with feature engineering, preprocessing, and model. |
| `cs_pipeline.pkl` | Integrated cross-sell pipeline with feature engineering, preprocessing, and model. |
| `pipeline_config.json` | Stores selected model names, thresholds, band edges, cost, revenue, and capacity values. |

Current selected models:

```text
Churn model:      XGBoost
Cross-sell model: Linear SVM
```

Current business thresholds:

```text
Churn threshold:      0.1985
Cross-sell threshold: 0.3380
Churn capacity:       25%
Cross-sell capacity:  30%
Contact cost:         $5
Revenue per accept:   $200
```

## Feature Engineering

The deployment pipeline creates only the important engineered features used in the final model pipeline:

```text
risk_indicator = missed_payments_6m + complaint_raised
complaint_nps_interaction = (10 - nps_score) * (complaint_raised + 1)
```

These features are created inside `predict_pipeline.py`, so the same logic is applied during both single prediction and batch scoring.

## Prediction Workflow

### Single Customer Prediction

1. User enters customer details in the website.
2. `static/app.js` sends the input as JSON to `/api/predict`.
3. `app.py` receives the request and passes the data to `predict_pipeline.py`.
4. `predict_pipeline.py` applies feature engineering, preprocessing, and model prediction.
5. The saved thresholds are applied to create churn and cross-sell flags.
6. The backend returns probabilities, bands, recommended action, and factor values.
7. The frontend displays the result on the page.

### Batch CSV Scoring

1. User uploads a CSV file from the Batch Scoring page.
2. `static/app.js` sends the file to `/api/upload`.
3. `app.py` checks whether required input columns are present.
4. `predict_pipeline.py` scores every customer row.
5. The backend creates scored output, retention target list, and cross-sell target list.
6. The frontend shows a preview and download links.

## Dashboard Workflow

The dashboard displays saved project summary results from `static/dashboard_summary.json`.

It shows:

- Total customers.
- Actual churn rate.
- Average churn probability.
- Average cross-sell probability.
- Campaign economics.
- Contact capacity.
- Final model performance.
- Model comparison.
- Risk and value segment distributions.
- Channel effectiveness.

The dashboard is mainly used to present the final project results clearly. New single-customer predictions do not retrain the model and do not automatically change the saved dashboard summary.

## How to Run

Install required packages:

```bash
pip install -r requirements.txt
```

Run the Flask application:

```bash
python app.py
```

If you want to run on a specific port:

```bash
PORT=5025 python app.py
```

Open the application in a browser:

```text
http://127.0.0.1:5025/
```

If you run without setting `PORT`, open:

```text
http://127.0.0.1:5001/
```

## Input Data for Batch Scoring

The batch input CSV should contain only input features. It should not require target columns such as:

```text
churned
cross_sell_accepted
```

Those target columns are used during model training and evaluation, not for predicting new customers.

A sample input file is available at:

```text
static/sample_input.csv
```

## Files Not Required for the HTML/JS Version

The HTML/JS application does not require the React frontend folder to run. The actual app used here is served from the `static/` folder by Flask.

The following folders/files are generated or optional and are not part of the main explanation:

```text
__pycache__/
temp_downloads/
react_frontend/
```