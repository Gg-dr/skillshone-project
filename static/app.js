document.addEventListener("DOMContentLoaded", () => {
    if (window.lucide) lucide.createIcons();

    const productFlags = [
        "has_credit_card",
        "has_personal_loan",
        "has_home_loan",
        "has_investment_account",
        "has_insurance_product",
    ];
    let customerBrowserData = { retention: [], crosssell: [] };
    let currentCustomerList = "retention";
    let selectedCustomer = null;

    let trainingResults = { churn: [], crosssell: [] };

    const featureSignals = {
        churn: [
            { name: "NPS score", detail: "Lower satisfaction usually increases churn risk.", strength: 92 },
            { name: "Service calls and complaints", detail: "More support friction is a strong churn warning.", strength: 86 },
            { name: "Tenure months", detail: "Shorter relationship history can increase risk.", strength: 78 },
            { name: "Missed payments", detail: "Payment issues add risk signal.", strength: 69 },
            { name: "CLV score", detail: "Used with churn probability for retention value.", strength: 64 },
        ],
        crosssell: [
            { name: "Campaign engagement", detail: "Opened and clicked campaigns improve offer likelihood.", strength: 91 },
            { name: "Products held", detail: "Existing relationship depth affects cross-sell response.", strength: 82 },
            { name: "Preferred channel", detail: "Some channels show stronger acceptance rates.", strength: 73 },
            { name: "Account balance and income", detail: "Financial capacity helps identify suitable offers.", strength: 68 },
            { name: "CLV score", detail: "Higher-value customers are stronger campaign candidates.", strength: 62 },
        ],
    };

    document.querySelectorAll(".nav-item").forEach(button => {
        button.addEventListener("click", () => switchTab(button.dataset.tab));
    });
    document.querySelectorAll(".model-tab").forEach(button => {
        button.addEventListener("click", () => {
            document.querySelectorAll(".model-tab").forEach(item => item.classList.toggle("active", item === button));
            renderModelComparison(button.dataset.modelView);
        });
    });
    document.querySelectorAll(".feature-tab").forEach(button => {
        button.addEventListener("click", () => {
            document.querySelectorAll(".feature-tab").forEach(item => item.classList.toggle("active", item === button));
            renderFeatureSignals(button.dataset.featureView);
        });
    });
    document.querySelectorAll(".browser-tab").forEach(button => {
        button.addEventListener("click", () => {
            currentCustomerList = button.dataset.customerList;
            document.querySelectorAll(".browser-tab").forEach(item => item.classList.toggle("active", item === button));
            selectedCustomer = null;
            loadCustomerBrowser();
        });
    });
    byId("customer-search")?.addEventListener("input", renderCustomerSidebar);

    byId("predict-form")?.addEventListener("submit", runPrediction);
    byId("predict-form")?.addEventListener("input", event => {
        if (productFlags.includes(event.target.name)) syncProductCount();
    });
    byId("score-file")?.addEventListener("click", uploadCsv);

    syncProductCount();
    loadDashboard();
    renderModelComparison("churn");
    renderFeatureSignals("churn");


    function switchTab(tab) {
        document.querySelectorAll(".nav-item").forEach(item => {
            item.classList.toggle("active", item.dataset.tab === tab);
        });
        document.querySelectorAll(".tab").forEach(panel => {
            panel.classList.toggle("active", panel.id === `${tab}-tab`);
        });

        const titles = {
            dashboard: ["Executive Dashboard", "Customer Churn & Cross-Sell Prediction", "Model results, customer segments, campaign value, and scoring outputs in one place."],
            customers: ["Customer Browser", "Priority Customer Lists", "Browse top retention and cross-sell customers with a profile and score detail panel."],
            predict: ["Live Scoring", "Single Customer Prediction", "Enter one customer profile and review the model decision with top contributing signals."],
            batch: ["Batch Workspace", "Batch CSV Scoring", "Upload customer records, score both models, preview results, and download the output."],
        };
        setText("page-eyebrow", titles[tab][0]);
        setText("page-title", titles[tab][1]);
        setText("page-subtitle", titles[tab][2]);
        if (tab === "customers") loadCustomerBrowser();
        if (window.lucide) lucide.createIcons();
    }

    async function loadDashboard() {
        try {
            const response = await fetch("/api/summary");
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || "Could not load dashboard summary");

            const retentionShare = Number(data.financials.retention_contacts) / Number(data.total_customers);
            const crosssellShare = Number(data.financials.crosssell_contacts) / Number(data.total_customers);
            const churnPerf = data.model_performance.churn;
            const csPerf = data.model_performance.crosssell;

            setText("churn-threshold", Number(data.config.churn_threshold).toFixed(4));
            setText("crosssell-threshold", Number(data.config.crosssell_threshold).toFixed(4));
            setText("total-customers", whole(data.total_customers));
            setText("avg-churn", pct(data.pred_churn_rate));
            setText("avg-crosssell", pct(data.pred_crosssell_rate));
            setText("actual-churn", pct(data.actual_churn_rate));
            setText("net-value", money(data.financials.total_net));
            setText("total-revenue", money(data.financials.total_revenue));
            setText("total-cost", money(data.financials.total_cost));
            setText("total-contacts", whole(Number(data.financials.retention_contacts) + Number(data.financials.crosssell_contacts)));
            setText("retention-net", money(data.financials.retention_net));
            setText("retention-contacts", whole(data.financials.retention_contacts));
            setText("crosssell-net", money(data.financials.crosssell_net));
            setText("crosssell-contacts", whole(data.financials.crosssell_contacts));
            setText("retention-contact-share", pct(retentionShare));
            setText("crosssell-contact-share", pct(crosssellShare));

            setRing("retention-ring", retentionShare, "#e14f67");
            setRing("crosssell-ring", crosssellShare, "#0da6a6");

            setText("churn-precision", pct(churnPerf.precision));
            setText("churn-recall", pct(churnPerf.recall));
            setText("churn-pr", fixed(churnPerf.pr_auc));
            setText("churn-roc", fixed(churnPerf.roc_auc));
            setText("cs-precision", pct(csPerf.precision));
            setText("cs-recall", pct(csPerf.recall));
            setText("cs-pr", fixed(csPerf.pr_auc));
            setText("cs-roc", fixed(csPerf.roc_auc));

            setText("actual-churn-detail", pct(data.actual_churn_rate));
            setText("pred-churn-detail", pct(data.pred_churn_rate));
            setText("actual-crosssell", pct(data.actual_crosssell_rate));
            setText("pred-crosssell-detail", pct(data.pred_crosssell_rate));

            setText("churn-profit", money(churnPerf.profit));
            setText("churn-threshold-detail", fixed(churnPerf.threshold, 4));
            setText("churn-contacts", whole(churnPerf.contacts));
            setText("churn-precision-detail", pct(churnPerf.precision));
            setText("churn-recall-detail", pct(churnPerf.recall));
            setText("cs-profit", money(csPerf.profit));
            setText("cs-threshold-detail", fixed(csPerf.threshold, 4));
            setText("cs-contacts", whole(csPerf.contacts));
            setText("cs-precision-detail", pct(csPerf.precision));
            setText("cs-recall-detail", pct(csPerf.recall));

            renderMetricBars("churn-metric-bars", churnPerf, "#e14f67");
            renderMetricBars("cs-metric-bars", csPerf, "#0da6a6");
            renderBarChart("churn-chart", data.risk_band_counts, ["Low Risk", "Medium Risk", "High Risk"], ["#25a18e", "#f2b84b", "#e14f67"]);
            renderBarChart("crosssell-chart", data.crosssell_band_counts, ["Low Probability", "Medium Probability", "High Probability"], ["#6c7a92", "#5b6ee1", "#0da6a6"]);
            renderBarChart("clv-chart", data.clv_segment_counts, ["Low", "Medium", "High", "Premium"], ["#6c7a92", "#0da6a6", "#5b6ee1", "#f2b84b"]);
            trainingResults = data.model_comparison || trainingResults;
            const activeModelTab = document.querySelector(".model-tab.active")?.dataset.modelView || "churn";
            renderModelComparison(activeModelTab);
            renderChannelList(data.channel_effectiveness);
        } catch (error) {
            setText("page-subtitle", error.message);
        }
    }

    function renderModelComparison(view) {
        const rows = trainingResults[view] || [];
        const maxPr = Math.max(...rows.map(row => Number(row.pr_auc || row.pr || 0)), 1);
        const container = byId("model-comparison-chart");
        if (!container) return;
        if (!rows.length) {
            container.innerHTML = `<div class="empty-state">Model comparison will appear after dashboard summary loads.</div>`;
            return;
        }
        container.innerHTML = rows.map(row => {
            const pr = Number(row.pr_auc || row.pr || 0);
            const roc = Number(row.roc_auc || row.roc || 0);
            const isMissing = pr === 0 && roc === 0;
            return `
                <div class="model-row ${isMissing ? "muted-row" : ""}">
                    <div class="model-row-main">
                        <b>${row.model}</b>
                        <span>${row.note || "Tuned and calibrated"}</span>
                    </div>
                    <div class="model-score">
                        <small>Profit</small>
                        <strong>${isMissing ? "Add" : money(row.profit || 0)}</strong>
                    </div>
                    <div class="model-bars">
                        <div><span style="width:${isMissing ? 8 : (pr / maxPr) * 100}%"></span></div>
                        <p>PR ${isMissing ? "--" : fixed(pr, 4)} | ROC ${isMissing ? "--" : fixed(roc, 4)} | Precision ${isMissing ? "--" : pct(row.precision)} | Recall ${isMissing ? "--" : pct(row.recall)}</p>
                        <p>Threshold ${isMissing ? "--" : fixed(row.threshold, 4)} | Contacts ${isMissing ? "--" : whole(row.contacts || 0)}</p>
                    </div>
                </div>
            `;
        }).join("");
    }

    function renderFeatureSignals(view) {
        const rows = featureSignals[view] || [];
        const container = byId("feature-importance-list");
        if (!container) return;
        container.innerHTML = rows.map(item => `
            <div class="feature-row">
                <div>
                    <b>${item.name}</b>
                    <span>${item.detail}</span>
                </div>
                <strong>${item.strength}</strong>
            </div>
        `).join("");
    }

    function renderMetricBars(id, metrics, color) {
        const rows = [
            ["ROC-AUC", metrics.roc_auc],
            ["PR-AUC", metrics.pr_auc],
            ["Precision", metrics.precision],
            ["Recall", metrics.recall],
        ];
        const container = byId(id);
        if (!container) return;
        container.innerHTML = rows.map(([label, value]) => `
            <div class="metric-bar-row">
                <span>${label}</span>
                <div><i style="width:${Number(value) * 100}%; background:${color};"></i></div>
                <b>${label.includes("AUC") ? fixed(value) : pct(value)}</b>
            </div>
        `).join("");
    }

    function renderBarChart(id, counts, labelOrder, colors) {
        const container = byId(id);
        if (!container) return;
        const source = counts || {};
        const entries = labelOrder.filter(label => Object.hasOwn(source, label)).map(label => [label, source[label]]);
        const total = entries.reduce((sum, [, value]) => sum + Number(value), 0);
        const max = Math.max(...entries.map(([, value]) => Number(value)), 1);

        if (!entries.length || total === 0) {
            container.innerHTML = '<p class="muted">No chart values available.</p>';
            return;
        }

        container.innerHTML = entries.map(([label, value], index) => {
            const count = Number(value);
            const width = Math.max((count / max) * 100, 4);
            const share = (count / total) * 100;
            return `
                <div class="bar-row">
                    <div class="bar-label"><span>${label}</span><b>${whole(count)} (${share.toFixed(1)}%)</b></div>
                    <div class="bar-track"><span class="bar-fill" style="width:${width}%; background:${colors[index % colors.length]};"></span></div>
                </div>
            `;
        }).join("");
    }

    function renderChannelList(channels) {
        const entries = Object.entries(channels || {}).sort((a, b) => b[1].avg_accept_prob - a[1].avg_accept_prob);
        const container = byId("channel-list");
        if (!container) return;
        container.innerHTML = entries.map(([channel, stats], index) => `
            <div class="leader-row">
                <span>${index + 1}</span>
                <div><b>${channel}</b><small>${whole(stats.count)} customers | churn ${pct(stats.avg_churn_prob)}</small></div>
                <strong>${pct(stats.avg_accept_prob)}</strong>
            </div>
        `).join("");
    }

    async function loadCustomerBrowser() {
        if (customerBrowserData[currentCustomerList].length) {
            renderCustomerSidebar();
            return;
        }
        const container = byId("customer-list");
        if (container) container.innerHTML = '<p class="muted">Loading customers...</p>';
        try {
            const response = await fetch(`/api/customers/${currentCustomerList}`);
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || "Could not load customer list");
            customerBrowserData[currentCustomerList] = data;
            renderCustomerSidebar();
        } catch (error) {
            if (container) container.innerHTML = '<p class="muted">Could not load customer list.</p>';
        }
    }

    function renderCustomerSidebar() {
        const search = (byId("customer-search")?.value || "").trim().toLowerCase();
        const baseRows = customerBrowserData[currentCustomerList] || [];
        const rows = baseRows.filter(row => !search || String(row.customer_id).toLowerCase().includes(search));
        const list = byId("customer-list");
        if (!list) return;

        setText("browser-list-label", currentCustomerList === "retention" ? "Top churn customers" : "Top cross-sell customers");
        setText("browser-list-count", whole(rows.length));

        if (!rows.length) {
            list.innerHTML = '<p class="muted">No matching customers found.</p>';
            clearCustomerDetail();
            return;
        }

        list.innerHTML = rows.slice(0, 1000).map((row, index) => {
            const primaryProb = currentCustomerList === "retention" ? row.churn_prob : row.accept_prob;
            const band = currentCustomerList === "retention" ? row.churn_risk_band : row.crosssell_prob_band;
            return `
                <button class="customer-list-item ${selectedCustomer?.customer_id === row.customer_id ? "active" : ""}" data-customer-id="${row.customer_id}">
                    <span>${String(index + 1).padStart(2, "0")}</span>
                    <div>
                        <b>${row.customer_id}</b>
                        <small>${band || "Selected"} | ${row.clv_segment || "CLV"} CLV</small>
                    </div>
                    <strong>${pct(primaryProb || 0)}</strong>
                </button>
            `;
        }).join("");

        list.querySelectorAll(".customer-list-item").forEach(button => {
            button.addEventListener("click", () => {
                const row = rows.find(item => item.customer_id === button.dataset.customerId);
                selectedCustomer = row;
                renderCustomerSidebar();
                renderCustomerDetail(row);
            });
        });

        if (!selectedCustomer || selectedCustomer.list_type !== currentCustomerList) {
            selectedCustomer = rows[0];
            renderCustomerDetail(selectedCustomer);
            const first = list.querySelector(".customer-list-item");
            if (first) first.classList.add("active");
        }
    }

    function renderCustomerDetail(row) {
        if (!row) {
            clearCustomerDetail();
            return;
        }
        const isRetention = row.list_type === "retention";
        setText("selected-action", row.recommended_action || "Customer Detail");
        setText("selected-customer-id", row.customer_id);
        setText("selected-customer-desc", isRetention
            ? "This customer is in the retention priority list, sorted by churn probability."
            : "This customer is in the cross-sell priority list, sorted by acceptance probability.");
        setText("selected-badge", isRetention ? "Retention" : "Cross-Sell");
        byId("selected-badge")?.classList.toggle("crosssell", !isRetention);
        setText("selected-churn-prob", pct(row.churn_prob || 0));
        setText("selected-risk-band", row.churn_risk_band || "Not prioritized");
        setText("selected-crosssell-prob", pct(row.accept_prob || 0));
        setText("selected-crosssell-band", row.crosssell_prob_band || "Not prioritized");
        setText("selected-clv", row.clv_segment || "--");
        setText("selected-clv-score", row.clv_score ? `Score ${whole(row.clv_score)}` : "--");

        renderProfileList("selected-profile", [
            ["Age", row.age],
            ["Gender", row.gender],
            ["Occupation", row.occupation],
            ["Region", row.region],
            ["Account Type", row.account_type],
            ["Tenure", row.tenure_months ? `${whole(row.tenure_months)} months` : "--"],
        ]);
        renderProfileList("selected-activity", [
            ["Credit Score", row.credit_score],
            ["Balance", money(row.account_balance || 0)],
            ["Products", row.num_products_held],
            ["Monthly Txns", row.avg_monthly_transactions],
            ["Digital Usage", row.digital_channel_usage_pct ? `${whole(row.digital_channel_usage_pct)}%` : "--"],
            ["NPS", row.nps_score ?? "--"],
        ]);
        renderProfileList("selected-campaign", [
            ["Preferred Channel", row.preferred_campaign_channel],
            ["Last Campaign", row.last_campaign_type],
            ["Days Since Campaign", row.days_since_last_campaign],
            ["Offer Category", row.campaign_offer_category],
            ["Campaign Opens", row.campaigns_opened_12m],
            ["Campaign Clicks", row.campaigns_clicked_12m],
        ]);
    }

    function clearCustomerDetail() {
        setText("selected-action", "Customer Detail");
        setText("selected-customer-id", "Select a customer");
        setText("selected-customer-desc", "Choose a customer from the sidebar to view profile, model scores, and recommended action.");
        setText("selected-badge", "Waiting");
    }

    function renderProfileList(id, rows) {
        const container = byId(id);
        if (!container) return;
        container.innerHTML = rows.map(([label, value]) => `
            <div><span>${label}</span><b>${value ?? "--"}</b></div>
        `).join("");
    }

    function syncProductCount() {
        const input = byId("num-products-held");
        if (!input) return;
        const count = productFlags.reduce((total, name) => {
            const flag = document.querySelector(`[name="${name}"]`);
            return total + (flag && flag.checked ? 1 : 0);
        }, 0);
        input.value = 1 + count;
    }

    async function runPrediction(event) {
        event.preventDefault();
        syncProductCount();

        const form = event.currentTarget;
        const payload = {};
        new FormData(form).forEach((value, key) => {
            const input = form.elements[key];
            payload[key] = input && input.type === "number" ? Number(value) : value;
        });
        productFlags.forEach(name => {
            payload[name] = form.elements[name].checked ? 1 : 0;
        });
        payload.complaint_raised = Number(payload.complaint_raised);
        payload.num_products_held = Number(byId("num-products-held").value);

        const response = await fetch("/api/predict", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });
        const data = await response.json();
        if (!response.ok) {
            setText("decision-text", data.error || "Prediction failed.");
            return;
        }
        updatePrediction(data.predictions, data.contributions);
    }

    function updatePrediction(pred, contributions) {
        const action = pred.churn_flag === 1 ? "Retention" : pred.crosssell_flag === 1 ? "Cross-Sell" : "Monitor";
        setText("decision-action", action);
        setText("churn-result", pct(pred.churn_prob));
        setText("risk-band", pred.churn_risk_band);
        setText("crosssell-result", pct(pred.accept_prob));
        setText("offer-flag", pred.crosssell_flag === 1 ? "Target Offer" : "No Offer");
        setText("decision-text", pred.churn_flag === 1
            ? "Prioritize retention before any new offer."
            : pred.crosssell_flag === 1
                ? "Customer is a strong cross-sell candidate."
                : "No immediate campaign action is required.");
        renderFactors("churn-factors", contributions.churn);
        renderFactors("crosssell-factors", contributions.crosssell);
    }

    function renderFactors(id, factors) {
        const container = byId(id);
        if (!container) return;
        if (!factors || factors.length === 0) {
            container.textContent = "No factors available.";
            return;
        }
        container.innerHTML = factors.map(item => {
            const sign = item.contribution >= 0 ? "+" : "";
            const cls = item.contribution >= 0 ? "positive" : "negative";
            return `<div class="factor-row"><span>${item.display_name}</span><b class="${cls}">${sign}${item.contribution.toFixed(3)}</b></div>`;
        }).join("");
    }

    async function uploadCsv() {
        const fileInput = byId("csv-file");
        const resultBox = byId("batch-results");
        if (!fileInput.files.length) {
            resultBox.innerHTML = '<div class="card-head"><i data-lucide="table-properties"></i><h2>Batch Results</h2></div><p>Please choose a CSV file first.</p>';
            if (window.lucide) lucide.createIcons();
            return;
        }

        const formData = new FormData();
        formData.append("file", fileInput.files[0]);
        resultBox.innerHTML = '<div class="card-head"><i data-lucide="loader"></i><h2>Batch Results</h2></div><p class="muted">Scoring file...</p>';
        if (window.lucide) lucide.createIcons();

        const response = await fetch("/api/upload", { method: "POST", body: formData });
        const data = await response.json();
        if (!response.ok) {
            resultBox.innerHTML = `<div class="card-head"><i data-lucide="circle-alert"></i><h2>Batch Results</h2></div><p>${data.error || "Scoring failed."}</p>`;
            if (window.lucide) lucide.createIcons();
            return;
        }

        resultBox.innerHTML = `
            <div class="card-head"><i data-lucide="table-properties"></i><h2>Batch Results</h2></div>
            <div class="mini-kpis">
                <div><span>Rows Scored</span><b>${whole(data.stats.total_rows)}</b></div>
                <div><span>Churn Targets</span><b>${whole(data.stats.churn_flags)} (${pct(data.stats.churn_rate)})</b></div>
                <div><span>Cross-Sell Targets</span><b>${whole(data.stats.crosssell_flags)} (${pct(data.stats.crosssell_rate)})</b></div>
            </div>
            <div class="download-row">
                <a class="text-link" href="${data.downloads?.scored || `/api/download/${data.file_key}`}">Download scored CSV</a>
                <a class="text-link" href="${data.downloads?.retention || `/api/download/${data.file_key}/retention`}">Download retention list</a>
                <a class="text-link" href="${data.downloads?.crosssell || `/api/download/${data.file_key}/crosssell`}">Download cross-sell list</a>
            </div>
            ${renderCampaignLists(data.campaign_lists)}
            <h3 class="preview-title">Scored Preview</h3>
            ${renderPreview(data.preview)}
        `;
        if (window.lucide) lucide.createIcons();
    }

    function renderCampaignLists(lists) {
        const retention = lists?.retention || [];
        const crosssell = lists?.crosssell || [];
        return `
            <div class="campaign-lists">
                <div class="campaign-list-card retention">
                    <div class="campaign-list-head">
                        <span>Retention List</span>
                        <strong>${whole(retention.length)}</strong>
                    </div>
                    ${renderTargetRows(retention, "retention")}
                </div>
                <div class="campaign-list-card crosssell">
                    <div class="campaign-list-head">
                        <span>Cross-Sell List</span>
                        <strong>${whole(crosssell.length)}</strong>
                    </div>
                    ${renderTargetRows(crosssell, "crosssell")}
                </div>
            </div>
        `;
    }

    function renderTargetRows(rows, type) {
        if (!rows.length) {
            return '<p class="muted">No customers selected for this list.</p>';
        }
        return `
            <div class="target-list">
                ${rows.map((row, index) => {
                    const customer = row.customer_id || `Row ${index + 1}`;
                    const mainProb = type === "retention" ? row.churn_prob : row.accept_prob;
                    const mainBand = type === "retention" ? row.churn_risk_band : row.crosssell_prob_band;
                    const subProb = type === "retention" ? row.accept_prob : row.churn_prob;
                    const subLabel = type === "retention" ? "Cross-sell" : "Churn";
                    return `
                        <div class="target-row">
                            <div>
                                <b>${customer}</b>
                                <span>${mainBand || "Selected"} | ${subLabel}: ${pct(subProb || 0)}</span>
                            </div>
                            <strong>${pct(mainProb || 0)}</strong>
                        </div>
                    `;
                }).join("")}
            </div>
        `;
    }

    function renderPreview(rows) {
        if (!rows || rows.length === 0) return "";
        const headers = Object.keys(rows[0]);
        const head = headers.map(h => `<th>${h.replaceAll("_", " ")}</th>`).join("");
        const body = rows.map(row => `<tr>${headers.map(h => `<td>${formatCell(row[h])}</td>`).join("")}</tr>`).join("");
        return `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
    }

    function formatCell(value) {
        if (typeof value === "number" && value >= 0 && value <= 1) return pct(value);
        return value ?? "";
    }

    function setRing(id, value, color) {
        const element = byId(id);
        if (!element) return;
        const degrees = Math.min(Math.max(Number(value), 0), 1) * 360;
        element.style.background = `conic-gradient(${color} ${degrees}deg, #e9eef5 0deg)`;
    }

    function byId(id) {
        return document.getElementById(id);
    }

    function setText(id, value) {
        const element = byId(id);
        if (element) element.textContent = value;
    }

    function fixed(value, digits = 3) {
        return Number(value).toFixed(digits);
    }

    function pct(value) {
        return `${(Number(value) * 100).toFixed(1)}%`;
    }

    function money(value) {
        const n = Math.round(Number(value));
        return `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString()}`;
    }

    function whole(value) {
        return Math.round(Number(value)).toLocaleString();
    }
});