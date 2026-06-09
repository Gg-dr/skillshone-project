// Customer Churn & Cross-Sell Dashboard Frontend Logic

document.addEventListener('DOMContentLoaded', () => {
    const refreshIcons = () => {
        if (window.lucide) lucide.createIcons();
    };
    refreshIcons();

    let activeTab = 'dashboard';
    let summaryData = null;
    let priorityType = 'retention'; // 'retention' or 'crosssell'
    let priorityData = { retention: [], crosssell: [] };
    let priorityFiltered = [];
    let priorityPage = 1;
    const priorityLimit = 12;
    
    let chartRiskDist = null;
    let chartClvBreakdown = null;
    let chartChannel = null;

    const navItems = document.querySelectorAll('.nav-item');
    const tabPanes = document.querySelectorAll('.tab-pane');
    const pageTitle = document.getElementById('page-title');
    const pageSubtitle = document.getElementById('page-subtitle');
    const refreshBtn = document.getElementById('refresh-db-btn');

    const priorityToggleGroup = document.getElementById('priority-toggle-group');
    const prioritySearch = document.getElementById('priority-search');
    const priorityTableHeaders = document.getElementById('priority-table-headers');
    const priorityTableBody = document.getElementById('priority-table-body');
    const priorityListDesc = document.getElementById('priority-list-desc');
    const paginationInfo = document.getElementById('pagination-info-text');
    const btnPrevPage = document.getElementById('btn-prev-page');
    const btnNextPage = document.getElementById('btn-next-page');

    const sandboxForm = document.getElementById('sandbox-form');
    const sandboxCustSearch = document.getElementById('sandbox-customer-search');
    const btnLoadSandbox = document.getElementById('btn-load-sandbox');
    const sandboxBadge = document.getElementById('loaded-customer-badge');
    const churnProbPercent = document.getElementById('churn-prob-percent');
    const churnRiskBadge = document.getElementById('churn-risk-badge');
    const csProbPercent = document.getElementById('cs-prob-percent');
    const csAcceptBadge = document.getElementById('cs-accept-badge');
    const sandboxActionText = document.getElementById('sandbox-action-text');
    const churnFactorList = document.getElementById('churn-factor-list');
    const crosssellFactorList = document.getElementById('crosssell-factor-list');
    const productCountInput = document.getElementById('num_products_held');
    const productFlagFields = [
        'has_credit_card',
        'has_personal_loan',
        'has_home_loan',
        'has_investment_account',
        'has_insurance_product'
    ];

    const dropZone = document.getElementById('csv-drop-zone');
    const fileInput = document.getElementById('csv-file-input');
    const fileDetailsBox = document.getElementById('file-details-box');
    const uploadedFilename = document.getElementById('uploaded-filename');
    const btnRemoveFile = document.getElementById('btn-remove-file');
    const btnRunScoring = document.getElementById('btn-run-scoring');
    const scoringLoader = document.getElementById('scoring-loader');
    const batchEmptyState = document.getElementById('batch-empty-state');
    const batchResultsContent = document.getElementById('batch-results-content');
    
    const batchStatTotal = document.getElementById('batch-stat-total');
    const batchStatChurn = document.getElementById('batch-stat-churn');
    const batchStatChurnRate = document.getElementById('batch-stat-churn-rate');
    const batchStatCs = document.getElementById('batch-stat-cs');
    const batchStatCsRate = document.getElementById('batch-stat-cs-rate');
    const btnDownloadScored = document.getElementById('btn-download-scored');
    const batchPreviewBody = document.getElementById('batch-preview-body');

    let selectedFile = null;

    navItems.forEach(item => {
        item.addEventListener('click', () => {
            const tabName = item.getAttribute('data-tab');
            switchTab(tabName);
        });
    });

    function switchTab(tabName) {
        activeTab = tabName;
        
        navItems.forEach(item => {
            if (item.getAttribute('data-tab') === tabName) {
                item.classList.add('active');
            } else {
                item.classList.remove('active');
            }
        });

        tabPanes.forEach(pane => {
            if (pane.id === `tab-${tabName}`) {
                pane.classList.add('active');
            } else {
                pane.classList.remove('active');
            }
        });

        // Update titles
        if (tabName === 'dashboard') {
            pageTitle.innerText = "Customer Churn & Cross-Sell Prediction";
            pageSubtitle.innerText = "Retail banking churn and cross-sell dashboard";
        } else if (tabName === 'priority') {
            pageTitle.innerText = "Top Customers";
            pageSubtitle.innerText = "Customers ranked by model score";
            loadPriorityLists();
        } else if (tabName === 'sandbox') {
            pageTitle.innerText = "Single Customer Prediction";
            pageSubtitle.innerText = "Enter customer values";
        } else if (tabName === 'batch') {
            pageTitle.innerText = "Batch Scoring";
            pageSubtitle.innerText = "Upload and score customers";
        }
    }

    async function fetchSummary() {
        try {
            const response = await fetch('/api/summary');
            if (!response.ok) throw new Error("API error fetching summary stats");
            summaryData = await response.json();
            
            updateKpiCards(summaryData);
            if (activeTab === 'dashboard') {
                renderCharts(summaryData);
                updateProfitSummary(summaryData.financials);
                updateModelPerformance(summaryData.model_performance);
            }
            
            if (summaryData.config) {
                document.getElementById('status-churn-t').innerText = Number(summaryData.config.churn_threshold).toFixed(4);
                document.getElementById('status-cs-t').innerText = Number(summaryData.config.crosssell_threshold).toFixed(4);
            }
        } catch (error) {
            console.error("Error loading dashboard data:", error);
            pageSubtitle.innerText = "Start Flask and refresh.";
        }
    }

    function updateKpiCards(data) {
        document.getElementById('kpi-total-customers').innerText = data.total_customers.toLocaleString();
        document.getElementById('kpi-churn-rate').innerText = `${(data.pred_churn_rate * 100).toFixed(1)}%`;
        document.getElementById('kpi-actual-churn').innerText = `${(data.actual_churn_rate * 100).toFixed(1)}%`;
        document.getElementById('kpi-targeted-churn').innerText = `${(data.targeted_churn_rate * 100).toFixed(1)}%`;
        
        document.getElementById('kpi-crosssell-rate').innerText = `${(data.pred_crosssell_rate * 100).toFixed(1)}%`;
        document.getElementById('kpi-actual-cs').innerText = `${(data.actual_crosssell_rate * 100).toFixed(1)}%`;
        document.getElementById('kpi-targeted-cs').innerText = `${(data.targeted_crosssell_rate * 100).toFixed(1)}%`;
        
        const netProfit = data.financials.total_net;
        const profitEl = document.getElementById('kpi-net-profit');
        profitEl.innerText = `${netProfit >= 0 ? '' : '-'}$${Math.abs(netProfit).toLocaleString(undefined, {maximumFractionDigits: 0})}`;
    }

    function updateProfitSummary(f) {
        const isBacktest = f.profit_mode === 'backtest';
        document.getElementById('profit-summary-title').innerText = isBacktest
            ? 'Backtested Net Value'
            : 'Expected Net Value';
        document.getElementById('label-retention-revenue').innerText = isBacktest
            ? 'Saved Revenue'
            : 'Expected Saved Revenue';
        document.getElementById('label-cs-revenue').innerText = isBacktest
            ? 'Accepted Revenue'
            : 'Expected Accepted Revenue';

        document.getElementById('profit-retention').innerText = `$${Math.round(f.retention_net).toLocaleString()}`;
        document.getElementById('detail-retention-contacts').innerText = f.retention_contacts.toLocaleString();
        document.getElementById('detail-retention-revenue').innerText = `$${Math.round(f.retention_revenue).toLocaleString()}`;
        document.getElementById('detail-retention-cost').innerText = `$${Math.round(f.retention_cost).toLocaleString()}`;

        document.getElementById('profit-crosssell').innerText = `$${Math.round(f.crosssell_net).toLocaleString()}`;
        document.getElementById('detail-cs-contacts').innerText = f.crosssell_contacts.toLocaleString();
        document.getElementById('detail-cs-revenue').innerText = `$${Math.round(f.crosssell_revenue).toLocaleString()}`;
        document.getElementById('detail-cs-cost').innerText = `$${Math.round(f.crosssell_cost).toLocaleString()}`;
    }

    function updateModelPerformance(performance) {
        if (!performance) return;

        const pct = value => `${(Number(value) * 100).toFixed(1)}%`;
        const dec = value => Number(value).toFixed(3);
        const money = value => `$${Math.round(Number(value)).toLocaleString()}`;
        const churn = performance.churn || {};
        const cs = performance.crosssell || {};

        document.getElementById('metric-churn-precision').innerText = pct(churn.precision);
        document.getElementById('metric-churn-recall').innerText = pct(churn.recall);
        document.getElementById('metric-churn-f1').innerText = dec(churn.f1_score);
        document.getElementById('metric-churn-roc').innerText = dec(churn.roc_auc);
        document.getElementById('metric-churn-pr').innerText = dec(churn.pr_auc);
        document.getElementById('metric-churn-profit').innerText = money(churn.profit);

        document.getElementById('metric-cs-precision').innerText = pct(cs.precision);
        document.getElementById('metric-cs-recall').innerText = pct(cs.recall);
        document.getElementById('metric-cs-f1').innerText = dec(cs.f1_score);
        document.getElementById('metric-cs-roc').innerText = dec(cs.roc_auc);
        document.getElementById('metric-cs-pr').innerText = dec(cs.pr_auc);
        document.getElementById('metric-cs-profit').innerText = money(cs.profit);
    }

    function renderCharts(data) {
        if (!window.Chart) {
            console.warn("Chart.js is not available; skipping chart rendering.");
            return;
        }
        if (chartRiskDist) chartRiskDist.destroy();
        if (chartClvBreakdown) chartClvBreakdown.destroy();
        if (chartChannel) chartChannel.destroy();

        // 1. Churn Risk Distribution Doughnut Chart
        const riskCtx = document.getElementById('chart-risk-dist').getContext('2d');
        const riskLabels = Object.keys(data.risk_band_counts);
        const riskValues = Object.values(data.risk_band_counts);
        const riskColors = riskLabels.map(label => {
            if (label === 'High Risk') return '#f43f5e';
            if (label === 'Medium Risk') return '#f59e0b';
            return '#06b6d4';
        });

        chartRiskDist = new Chart(riskCtx, {
            type: 'doughnut',
            data: {
                labels: riskLabels,
                datasets: [{
                    data: riskValues,
                    backgroundColor: riskColors,
                    borderWidth: 1,
                    borderColor: '#ffffff'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: { color: '#475569', font: { family: 'Inter', size: 13 } }
                    }
                }
            }
        });

        const clvCtx = document.getElementById('chart-clv-breakdown').getContext('2d');
        const clvLabels = ['Low Probability', 'Medium Probability', 'High Probability'];
        const clvValues = clvLabels.map(label => data.crosssell_band_counts[label] || 0);

        chartClvBreakdown = new Chart(clvCtx, {
            type: 'bar',
            data: {
                labels: clvLabels,
                datasets: [{
                    label: 'Customers count',
                    data: clvValues,
                    backgroundColor: '#2563eb',
                    borderRadius: 6
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false }
                },
                scales: {
                    x: { grid: { display: false }, ticks: { color: '#475569', font: { size: 12 } } },
                    y: { grid: { color: '#e5e7eb' }, ticks: { color: '#475569', font: { size: 12 } } }
                }
            }
        });

        const channelCtx = document.getElementById('chart-channel-effectiveness').getContext('2d');
        const channels = Object.keys(data.channel_effectiveness);
        const avgChurnProbs = channels.map(c => data.channel_effectiveness[c].avg_churn_prob * 100);
        const avgCsProbs = channels.map(c => data.channel_effectiveness[c].avg_accept_prob * 100);

        chartChannel = new Chart(channelCtx, {
            type: 'bar',
            data: {
                labels: channels,
                datasets: [
                    {
                        label: 'Average Churn Prob (%)',
                        data: avgChurnProbs,
                        backgroundColor: '#f43f5e',
                        borderRadius: 4
                    },
                    {
                        label: 'Average Cross-Sell Accept (%)',
                        data: avgCsProbs,
                        backgroundColor: '#10b981',
                        borderRadius: 4
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'top',
                        labels: { color: '#475569', font: { family: 'Inter', size: 13 } }
                    }
                },
                scales: {
                    x: { grid: { display: false }, ticks: { color: '#475569', font: { size: 12 } } },
                    y: { 
                        grid: { color: '#e5e7eb' }, 
                        ticks: { color: '#475569', font: { size: 12 }, callback: value => `${value}%` } 
                    }
                }
            }
        });
    }

    priorityToggleGroup.addEventListener('click', (e) => {
        const targetBtn = e.target.closest('.btn-tab-toggle');
        if (!targetBtn) return;
        
        priorityToggleGroup.querySelectorAll('.btn-tab-toggle').forEach(btn => btn.classList.remove('active'));
        targetBtn.classList.add('active');
        
        priorityType = targetBtn.getAttribute('data-type');
        priorityPage = 1;
        
        if (priorityType === 'retention') {
            priorityListDesc.innerText = "Highest churn probability";
        } else {
            priorityListDesc.innerText = "Highest cross-sell probability";
        }
        
        filterAndRenderPriorityTable();
    });

    prioritySearch.addEventListener('input', () => {
        priorityPage = 1;
        filterAndRenderPriorityTable();
    });

    async function loadPriorityLists() {
        try {
            if (priorityData.retention.length === 0) {
                const rRes = await fetch('/api/priority/retention');
                priorityData.retention = await rRes.json();
            }
            if (priorityData.crosssell.length === 0) {
                const cRes = await fetch('/api/priority/crosssell');
                priorityData.crosssell = await cRes.json();
            }
            
            filterAndRenderPriorityTable();
        } catch (error) {
            console.error("Error loading priority lists:", error);
            priorityTableBody.innerHTML = `<tr><td colspan="5" class="text-center py-8 text-rose">Could not load customers. Start Flask and refresh.</td></tr>`;
        }
    }

    function filterAndRenderPriorityTable() {
        const search = prioritySearch.value.trim().toLowerCase();
        const baseList = priorityData[priorityType];
        
        if (search) {
            priorityFiltered = baseList.filter(cust => 
                String(cust.customer_id).toLowerCase().includes(search)
            );
        } else {
            priorityFiltered = [...baseList];
        }
        
        renderPriorityTable();
    }

    function probabilityBandClass(label) {
        if (!label) return 'low';
        const normalized = label.toLowerCase();
        if (normalized.includes('high')) return 'green';
        if (normalized.includes('medium')) return 'medium';
        return 'low';
    }

    function renderPriorityTable() {
        priorityTableHeaders.innerHTML = '';
        priorityTableBody.innerHTML = '';
        
        if (priorityFiltered.length === 0) {
            priorityTableBody.innerHTML = `<tr><td colspan="5" class="text-center py-8">No matching customers found</td></tr>`;
            paginationInfo.innerText = "Showing 0-0 of 0 entries";
            btnPrevPage.disabled = true;
            btnNextPage.disabled = true;
            return;
        }

        const total = priorityFiltered.length;
        const pages = Math.ceil(total / priorityLimit);
        const start = (priorityPage - 1) * priorityLimit;
        const end = Math.min(start + priorityLimit, total);
        const pageItems = priorityFiltered.slice(start, end);
        
        paginationInfo.innerText = `Showing ${start + 1}-${end} of ${total} entries`;
        btnPrevPage.disabled = priorityPage === 1;
        btnNextPage.disabled = priorityPage === pages;

        if (priorityType === 'retention') {
            priorityTableHeaders.innerHTML = `
                <th>Customer ID</th>
                <th>Churn Prob</th>
                <th>Risk Band</th>
                <th>CLV Segment</th>
                <th>Actions</th>
            `;
            
            pageItems.forEach(cust => {
                const tr = document.createElement('tr');
                const riskClass = cust.churn_risk_band.toLowerCase().split(' ')[0];
                tr.innerHTML = `
                    <td><strong>${cust.customer_id}</strong></td>
                    <td class="font-semibold text-rose">${(cust.churn_prob * 100).toFixed(1)}%</td>
                    <td><span class="risk-badge ${riskClass}">${cust.churn_risk_band}</span></td>
                    <td><span class="clv-badge ${cust.clv_segment || ''}">${cust.clv_segment || 'N/A'}</span></td>
                    <td>
                        <button class="btn btn-secondary btn-sm btn-simulate" data-id="${cust.customer_id}">
                            <i data-lucide="sliders" class="w-3 h-3 mr-1 inline"></i> View
                        </button>
                    </td>
                `;
                priorityTableBody.appendChild(tr);
            });
        } else {
            priorityTableHeaders.innerHTML = `
                <th>Customer ID</th>
                <th>Accept Prob</th>
                <th>Probability Band</th>
                <th>CLV Segment</th>
                <th>Actions</th>
            `;
            
            pageItems.forEach(cust => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td><strong>${cust.customer_id}</strong></td>
                    <td class="font-semibold text-emerald">${(cust.accept_prob * 100).toFixed(1)}%</td>
                    <td><span class="risk-badge ${probabilityBandClass(cust.crosssell_prob_band)}">${cust.crosssell_prob_band || 'N/A'}</span></td>
                    <td><span class="clv-badge ${cust.clv_segment || ''}">${cust.clv_segment || 'N/A'}</span></td>
                    <td>
                        <button class="btn btn-secondary btn-sm btn-simulate" data-id="${cust.customer_id}">
                            <i data-lucide="sliders" class="w-3 h-3 mr-1 inline"></i> View
                        </button>
                    </td>
                `;
                priorityTableBody.appendChild(tr);
            });
        }
        
        refreshIcons();
        
        priorityTableBody.querySelectorAll('.btn-simulate').forEach(btn => {
            btn.addEventListener('click', () => {
                const custId = btn.getAttribute('data-id');
                loadCustomerIntoSandbox(custId);
            });
        });
    }

    btnPrevPage.addEventListener('click', () => {
        if (priorityPage > 1) {
            priorityPage--;
            renderPriorityTable();
        }
    });

    btnNextPage.addEventListener('click', () => {
        const pages = Math.ceil(priorityFiltered.length / priorityLimit);
        if (priorityPage < pages) {
            priorityPage++;
            renderPriorityTable();
        }
    });

    
    let predictTimeout = null;
    function triggerAutoPredict() {
        clearTimeout(predictTimeout);
        predictTimeout = setTimeout(runSandboxPrediction, 400);
    }

    function syncProductCount() {
        const selectedProducts = productFlagFields.reduce((total, field) => {
            const input = document.getElementById(field);
            return total + (input && input.checked ? 1 : 0);
        }, 0);
        productCountInput.value = 1 + selectedProducts;
    }

    sandboxForm.addEventListener('input', (e) => {
        if (e.target.type === 'number' || e.target.tagName === 'SELECT' || e.target.type === 'checkbox') {
            if (productFlagFields.includes(e.target.id)) {
                syncProductCount();
            }
            triggerAutoPredict();
        }
    });

    btnLoadSandbox.addEventListener('click', () => {
        const custId = sandboxCustSearch.value.trim();
        if (custId) loadCustomerIntoSandbox(custId);
    });

    sandboxCustSearch.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            const custId = sandboxCustSearch.value.trim();
            if (custId) loadCustomerIntoSandbox(custId);
        }
    });

    async function loadCustomerIntoSandbox(custId) {
        try {
            const response = await fetch(`/api/customer/${custId}`);
            if (!response.ok) {
                alert(`Customer ${custId} not found.`);
                return;
            }
            const data = await response.json();
            
            switchTab('sandbox');
            sandboxCustSearch.value = custId;
            
            sandboxBadge.innerHTML = `
                <span>Loaded: <strong>${custId}</strong> (CLV: ${data.details.clv_segment || 'N/A'})</span>
                <button type="button" id="btn-clear-sandbox">Reset</button>
            `;
            
            document.getElementById('btn-clear-sandbox').addEventListener('click', resetSandboxForm);

            const details = data.details;
            for (const key in details) {
                const input = document.getElementById(key);
                if (!input) continue;

                if (input.type === 'checkbox') {
                    input.checked = details[key] === 1;
                } else {
                    input.value = details[key] !== null ? details[key] : '';
                }
            }

            syncProductCount();
            updateSandboxUI(details, data.contributions);
        } catch (error) {
            console.error("Error loading customer into sandbox:", error);
        }
    }

    function resetSandboxForm() {
        sandboxForm.reset();
        sandboxCustSearch.value = '';
        sandboxBadge.innerHTML = `<span>Custom profile</span>`;
        syncProductCount();
        triggerAutoPredict();
    }

    async function runSandboxPrediction() {
        const formData = new FormData(sandboxForm);
        const payload = {};
        
        formData.forEach((value, key) => {
            // Convert numbers
            const inputEl = document.getElementById(key);
            if (inputEl && inputEl.type === 'number') {
                payload[key] = parseFloat(value);
            } else {
                payload[key] = value;
            }
        });
        
        syncProductCount();
        productFlagFields.forEach(field => {
            payload[field] = document.getElementById(field).checked ? 1 : 0;
        });
        payload['num_products_held'] = parseInt(productCountInput.value);

        payload['complaint_raised'] = parseInt(document.getElementById('complaint_raised').value);

        try {
            const response = await fetch('/api/predict', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (!response.ok) throw new Error("Prediction failed");
            const data = await response.json();
            
            updateSandboxUI(data.predictions, data.contributions);
        } catch (error) {
            console.error("Error scoring sandbox:", error);
        }
    }

    function updateSandboxUI(pred, contributions) {
        const churnP = pred.churn_prob;
        churnProbPercent.innerText = `${(churnP * 100).toFixed(1)}%`;

        churnRiskBadge.innerText = pred.churn_risk_band || 'Scoring';
        churnRiskBadge.className = 'prediction-status-label';
        if (pred.churn_risk_band === 'High Risk') {
            churnRiskBadge.style.color = 'var(--color-rose)';
            churnRiskBadge.style.borderColor = 'rgba(244,63,94,0.3)';
            churnRiskBadge.style.backgroundColor = '#fff1f2';
        } else if (pred.churn_risk_band === 'Medium Risk') {
            churnRiskBadge.style.color = 'var(--color-amber)';
            churnRiskBadge.style.borderColor = 'rgba(245,158,11,0.3)';
            churnRiskBadge.style.backgroundColor = '#fffbeb';
        } else {
            churnRiskBadge.style.color = 'var(--color-cyan)';
            churnRiskBadge.style.borderColor = 'rgba(6,182,212,0.3)';
            churnRiskBadge.style.backgroundColor = '#ecfeff';
        }

        const csP = pred.accept_prob;
        csProbPercent.innerText = `${(csP * 100).toFixed(1)}%`;

        const isEligible = pred.crosssell_flag === 1;
        csAcceptBadge.innerText = isEligible ? 'Target Offer' : 'No Offer';
        csAcceptBadge.className = 'prediction-status-label';
        if (isEligible) {
            csAcceptBadge.style.color = 'var(--color-emerald)';
            csAcceptBadge.style.borderColor = 'rgba(16,185,129,0.3)';
            csAcceptBadge.style.backgroundColor = '#ecfdf5';
        } else {
            csAcceptBadge.style.color = 'var(--text-muted)';
            csAcceptBadge.style.borderColor = 'var(--color-divider)';
            csAcceptBadge.style.backgroundColor = '#f8fafc';
        }

        if (pred.churn_flag === 1) {
            sandboxActionText.innerText = 'Contact this customer for retention support.';
        } else if (isEligible) {
            sandboxActionText.innerText = 'Customer is suitable for a cross-sell offer.';
        } else {
            sandboxActionText.innerText = 'No immediate campaign action needed.';
        }

        renderFactorList(churnFactorList, contributions && contributions.churn);
        renderFactorList(crosssellFactorList, contributions && contributions.crosssell);
    }

    function renderFactorList(container, factors) {
        container.innerHTML = '';
        if (!factors || factors.length === 0) {
            container.innerHTML = `<div class="empty-state">No factors available</div>`;
            return;
        }

        factors.forEach(item => {
            const row = document.createElement('div');
            row.className = 'factor-row';
            const signClass = item.contribution >= 0 ? 'positive' : 'negative';
            const sign = item.contribution >= 0 ? '+' : '';
            row.innerHTML = `
                <span class="factor-name">${item.display_name}</span>
                <span class="factor-score ${signClass}">${sign}${item.contribution.toFixed(3)}</span>
            `;
            container.appendChild(row);
        });
    }


    dropZone.addEventListener('click', () => fileInput.click());

    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            handleSelectedFile(e.target.files[0]);
        }
    });

    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('active');
    });

    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('active');
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('active');
        if (e.dataTransfer.files.length > 0) {
            handleSelectedFile(e.dataTransfer.files[0]);
        }
    });

    function handleSelectedFile(file) {
        if (!file.name.endsWith('.csv')) {
            alert('Please select a valid CSV file.');
            return;
        }
        selectedFile = file;
        uploadedFilename.innerText = file.name;
        dropZone.style.display = 'none';
        fileDetailsBox.style.display = 'flex';
        btnRunScoring.disabled = false;
    }

    btnRemoveFile.addEventListener('click', () => {
        selectedFile = null;
        fileInput.value = '';
        dropZone.style.display = 'block';
        fileDetailsBox.style.display = 'none';
        btnRunScoring.disabled = true;
        
        batchEmptyState.style.display = 'flex';
        batchResultsContent.style.display = 'none';
    });

    btnRunScoring.addEventListener('click', async () => {
        if (!selectedFile) return;

        const formData = new FormData();
        formData.append('file', selectedFile);
        
        scoringLoader.style.display = 'flex';
        btnRunScoring.disabled = true;
        btnRemoveFile.disabled = true;

        try {
            const response = await fetch('/api/upload', {
                method: 'POST',
                body: formData
            });
            
            if (!response.ok) {
                const errData = await response.json();
                throw new Error(errData.error || "Failed to score uploaded file.");
            }
            
            const results = await response.json();
            displayBatchResults(results);
        } catch (error) {
            alert(`Scoring error: ${error.message}`);
        } finally {
            scoringLoader.style.display = 'none';
            btnRunScoring.disabled = false;
            btnRemoveFile.disabled = false;
        }
    });

    function displayBatchResults(data) {
        batchEmptyState.style.display = 'none';
        batchResultsContent.style.display = 'block';

        batchStatTotal.innerText = data.stats.total_rows.toLocaleString();
        batchStatChurn.innerText = data.stats.churn_flags.toLocaleString();
        batchStatChurnRate.innerText = `${(data.stats.churn_rate * 100).toFixed(1)}% rate`;
        batchStatCs.innerText = data.stats.crosssell_flags.toLocaleString();
        batchStatCsRate.innerText = `${(data.stats.crosssell_rate * 100).toFixed(1)}% rate`;

        btnDownloadScored.href = `/api/download/${data.file_key}`;

        batchPreviewBody.innerHTML = '';
        data.preview.forEach(row => {
            const tr = document.createElement('tr');
            const riskClass = row.churn_risk_band.toLowerCase().split(' ')[0];
            tr.innerHTML = `
                <td><strong>${row.customer_id}</strong></td>
                <td class="font-semibold text-rose">${(row.churn_prob * 100).toFixed(1)}%</td>
                <td><span class="risk-badge ${riskClass}">${row.churn_risk_band}</span></td>
                <td class="font-semibold text-emerald">${(row.accept_prob * 100).toFixed(1)}%</td>
                <td><span class="risk-badge ${probabilityBandClass(row.crosssell_prob_band)}">${row.crosssell_prob_band || 'N/A'}</span></td>
                <td><span class="risk-badge ${row.crosssell_flag === 1 ? 'green' : 'low'}">${row.crosssell_flag === 1 ? 'Eligible' : 'Ineligible'}</span></td>
            `;
            batchPreviewBody.appendChild(tr);
        });

        refreshIcons();
    }

    refreshBtn.addEventListener('click', () => {
        refreshBtn.classList.add('spinning');
        fetchSummary().finally(() => {
            setTimeout(() => refreshBtn.classList.remove('spinning'), 1000);
        });
    });

    const styleSheet = document.createElement("style");
    styleSheet.innerText = `
        @keyframes spinAround {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
        }
        .spinning i {
            animation: spinAround 1s cubic-bezier(0.4, 0, 0.2, 1) infinite;
        }
    `;
    document.head.appendChild(styleSheet);

    fetchSummary();
    syncProductCount();
    triggerAutoPredict(); 
});