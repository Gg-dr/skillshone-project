// Customer Churn & Cross-Sell Dashboard Frontend Logic

document.addEventListener('DOMContentLoaded', () => {
    // --- Initialize Lucide Icons ---
    const refreshIcons = () => {
        if (window.lucide) lucide.createIcons();
    };
    refreshIcons();

    // --- State variables ---
    let activeTab = 'dashboard';
    let summaryData = null;
    let priorityType = 'retention'; // 'retention' or 'crosssell'
    let priorityData = { retention: [], crosssell: [] };
    let priorityFiltered = [];
    let priorityPage = 1;
    const priorityLimit = 12;
    
    // --- Chart instances (to destroy before recreating) ---
    let chartRiskDist = null;
    let chartClvBreakdown = null;
    let chartChannel = null;

    // --- DOM Elements ---
    const navItems = document.querySelectorAll('.nav-item');
    const tabPanes = document.querySelectorAll('.tab-pane');
    const pageTitle = document.getElementById('page-title');
    const pageSubtitle = document.getElementById('page-subtitle');
    const refreshBtn = document.getElementById('refresh-db-btn');

    // ROI Sliders
    const sliderCost = document.getElementById('slider-cost-contact');
    const sliderSaved = document.getElementById('slider-base-saved');
    const sliderRevenue = document.getElementById('slider-revenue-accept');
    
    const labelCost = document.getElementById('val-cost-contact');
    const labelSaved = document.getElementById('val-base-saved');
    const labelRevenue = document.getElementById('val-revenue-accept');

    // Priority list elements
    const priorityToggleGroup = document.getElementById('priority-toggle-group');
    const prioritySearch = document.getElementById('priority-search');
    const priorityTableHeaders = document.getElementById('priority-table-headers');
    const priorityTableBody = document.getElementById('priority-table-body');
    const priorityListDesc = document.getElementById('priority-list-desc');
    const paginationInfo = document.getElementById('pagination-info-text');
    const btnPrevPage = document.getElementById('btn-prev-page');
    const btnNextPage = document.getElementById('btn-next-page');

    // Sandbox elements
    const sandboxForm = document.getElementById('sandbox-form');
    const sandboxCustSearch = document.getElementById('sandbox-customer-search');
    const btnLoadSandbox = document.getElementById('btn-load-sandbox');
    const sandboxBadge = document.getElementById('loaded-customer-badge');
    const churnMeterBar = document.getElementById('churn-meter-bar');
    const churnProbPercent = document.getElementById('churn-prob-percent');
    const churnRiskBadge = document.getElementById('churn-risk-badge');
    const csMeterBar = document.getElementById('cs-meter-bar');
    const csProbPercent = document.getElementById('cs-prob-percent');
    const csAcceptBadge = document.getElementById('cs-accept-badge');
    const churnDriversList = document.getElementById('churn-drivers-list');
    const churnRestrainersList = document.getElementById('churn-restrainers-list');

    // Batch Scoring elements
    const dropZone = document.getElementById('csv-drop-zone');
    const fileInput = document.getElementById('csv-file-input');
    const fileDetailsBox = document.getElementById('file-details-box');
    const uploadedFilename = document.getElementById('uploaded-filename');
    const btnRemoveFile = document.getElementById('btn-remove-file');
    const overrideChurn = document.getElementById('override-churn-thresh');
    const overrideCs = document.getElementById('override-cs-thresh');
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

    // --- Tab Switching ---
    navItems.forEach(item => {
        item.addEventListener('click', () => {
            const tabName = item.getAttribute('data-tab');
            switchTab(tabName);
        });
    });

    function switchTab(tabName) {
        activeTab = tabName;
        
        // Update Nav Link classes
        navItems.forEach(item => {
            if (item.getAttribute('data-tab') === tabName) {
                item.classList.add('active');
            } else {
                item.classList.remove('active');
            }
        });

        // Show/Hide Panes
        tabPanes.forEach(pane => {
            if (pane.id === `tab-${tabName}`) {
                pane.classList.add('active');
            } else {
                pane.classList.remove('active');
            }
        });

        // Update titles
        if (tabName === 'dashboard') {
            pageTitle.innerText = "Predictive Business Dashboard";
            pageSubtitle.innerText = "Overview of churn risks, cross-sell optimization, and dynamic ROI";
        } else if (tabName === 'priority') {
            pageTitle.innerText = "Priority Customer Targeting";
            pageSubtitle.innerText = "Identified action lists for retention campaigns and cross-sell offers";
            loadPriorityLists();
        } else if (tabName === 'sandbox') {
            pageTitle.innerText = "Simulation Sandbox";
            pageSubtitle.innerText = "Adjust customer parameters and run real-time what-if predictive simulations";
        } else if (tabName === 'batch') {
            pageTitle.innerText = "Batch Scoring Pipeline";
            pageSubtitle.innerText = "Score entire customer CSV files and download predictions instantly";
        }
    }

    // --- Fetch Dashboard Summary Statistics ---
    async function fetchSummary() {
        const cost = sliderCost.value;
        const saved = sliderSaved.value;
        const revenue = sliderRevenue.value;
        
        try {
            const response = await fetch(`/api/summary?cost_contact=${cost}&base_value_saved=${saved}&revenue_per_accept=${revenue}`);
            if (!response.ok) throw new Error("API error fetching summary stats");
            summaryData = await response.json();
            
            updateKpiCards(summaryData);
            if (activeTab === 'dashboard') {
                renderCharts(summaryData);
                updateProfitSummary(summaryData.financials);
            }
            
            if (summaryData.config) {
                document.getElementById('status-churn-t').innerText = Number(summaryData.config.churn_threshold).toFixed(4);
                document.getElementById('status-cs-t').innerText = Number(summaryData.config.crosssell_threshold).toFixed(4);
            }
        } catch (error) {
            console.error("Error loading dashboard data:", error);
            pageSubtitle.innerText = "Backend data could not be loaded. Start the Flask server and refresh.";
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
            ? 'Backtested Campaign Net Value'
            : 'Expected Campaign Net Value';
        document.getElementById('label-retention-revenue').innerText = isBacktest
            ? 'Revenue from Actual Churners Targeted'
            : 'Expected Saved Revenue';
        document.getElementById('label-cs-revenue').innerText = isBacktest
            ? 'Revenue from Actual Acceptors Targeted'
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

    // --- Dynamic ROI Sliders Events ---
    sliderCost.addEventListener('input', () => {
        labelCost.innerText = `$${sliderCost.value}`;
        debounceSummaryFetch();
    });
    sliderSaved.addEventListener('input', () => {
        labelSaved.innerText = `$${sliderSaved.value}`;
        debounceSummaryFetch();
    });
    sliderRevenue.addEventListener('input', () => {
        labelRevenue.innerText = `$${sliderRevenue.value}`;
        debounceSummaryFetch();
    });

    let summaryTimeout = null;
    function debounceSummaryFetch() {
        clearTimeout(summaryTimeout);
        summaryTimeout = setTimeout(fetchSummary, 300);
    }

    // --- Chart rendering via ChartJS ---
    function renderCharts(data) {
        if (!window.Chart) {
            console.warn("Chart.js is not available; skipping chart rendering.");
            return;
        }
        // Destroy old charts to prevent duplicate canvases overlapping
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
                        position: 'right',
                        labels: { color: '#475569', font: { family: 'Inter', size: 11 } }
                    }
                }
            }
        });

        // 2. Cross-Sell Probability Band Breakdown Bar Chart
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
                    x: { grid: { display: false }, ticks: { color: '#475569' } },
                    y: { grid: { color: '#e5e7eb' }, ticks: { color: '#475569' } }
                }
            }
        });

        // 3. Campaign Channel Effectiveness Grouped Bar Chart
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
                        labels: { color: '#475569', font: { family: 'Inter' } }
                    }
                },
                scales: {
                    x: { grid: { display: false }, ticks: { color: '#475569' } },
                    y: { 
                        grid: { color: '#e5e7eb' }, 
                        ticks: { color: '#475569', callback: value => `${value}%` } 
                    }
                }
            }
        });
    }

    // --- Tab 2: Priority Lists Logic ---
    priorityToggleGroup.addEventListener('click', (e) => {
        const targetBtn = e.target.closest('.btn-tab-toggle');
        if (!targetBtn) return;
        
        // Update active class
        priorityToggleGroup.querySelectorAll('.btn-tab-toggle').forEach(btn => btn.classList.remove('active'));
        targetBtn.classList.add('active');
        
        priorityType = targetBtn.getAttribute('data-type');
        priorityPage = 1;
        
        if (priorityType === 'retention') {
            priorityListDesc.innerText = "Top active customers with highest predicted churn probability";
        } else {
            priorityListDesc.innerText = "Top active, non-churning customers with highest cross-sell offer acceptance probability";
        }
        
        filterAndRenderPriorityTable();
    });

    prioritySearch.addEventListener('input', () => {
        priorityPage = 1;
        filterAndRenderPriorityTable();
    });

    async function loadPriorityLists() {
        try {
            // Only fetch if lists are empty
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
            priorityTableBody.innerHTML = `<tr><td colspan="5" class="text-center py-8 text-rose">Failed to load priority lists. Make sure backend is running.</td></tr>`;
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
        // Clear body and headers
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

        // Injected headers based on type
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
                            <i data-lucide="sliders" class="w-3 h-3 mr-1 inline"></i> Sandbox
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
                            <i data-lucide="sliders" class="w-3 h-3 mr-1 inline"></i> Sandbox
                        </button>
                    </td>
                `;
                priorityTableBody.appendChild(tr);
            });
        }
        
        refreshIcons();
        
        // Add click events to "Simulate" buttons
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

    // --- Tab 3: What-If Sandbox Logic ---
    
    // Auto-predict debouncer
    let predictTimeout = null;
    function triggerAutoPredict() {
        clearTimeout(predictTimeout);
        predictTimeout = setTimeout(runSandboxPrediction, 400);
    }

    // Attach listeners to all inputs in sandbox form
    sandboxForm.addEventListener('input', (e) => {
        if (e.target.type === 'number' || e.target.tagName === 'SELECT' || e.target.type === 'checkbox') {
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
            
            // Switch view
            switchTab('sandbox');
            sandboxCustSearch.value = custId;
            
            // Set loaded badge
            sandboxBadge.innerHTML = `
                <span>Currently Simulating: <strong>${custId}</strong> (CLV Segment: ${data.details.clv_segment || 'N/A'})</span>
                <button type="button" id="btn-clear-sandbox">Reset to Default</button>
            `;
            
            document.getElementById('btn-clear-sandbox').addEventListener('click', resetSandboxForm);

            // Populate form fields
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

            // Trigger prediction & drivers chart immediately
            updateSandboxUI(details, data.contributions);
        } catch (error) {
            console.error("Error loading customer into sandbox:", error);
        }
    }

    function resetSandboxForm() {
        sandboxForm.reset();
        sandboxCustSearch.value = '';
        sandboxBadge.innerHTML = `<span>Creating Custom Simulation Profile</span>`;
        // Re-run standard prediction on defaults
        triggerAutoPredict();
    }

    async function runSandboxPrediction() {
        // Collect form data
        const formData = new FormData(sandboxForm);
        const payload = {};
        
        // Handle normal inputs
        formData.forEach((value, key) => {
            // Convert numbers
            const inputEl = document.getElementById(key);
            if (inputEl && inputEl.type === 'number') {
                payload[key] = parseFloat(value);
            } else {
                payload[key] = value;
            }
        });
        
        // Handle checkbox booleans (unchecked boxes aren't in FormData)
        const checkFields = ['has_credit_card', 'has_personal_loan', 'has_home_loan', 'has_investment_account', 'has_insurance_product'];
        checkFields.forEach(field => {
            payload[field] = document.getElementById(field).checked ? 1 : 0;
        });

        // Set select elements numbers
        payload['complaint_raised'] = parseInt(document.getElementById('complaint_raised').value);

        try {
            const response = await fetch('/api/predict', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (!response.ok) throw new Error("Sandbox prediction failed");
            const data = await response.json();
            
            updateSandboxUI(data.predictions, data.contributions);
        } catch (error) {
            console.error("Error scoring sandbox:", error);
        }
    }

    function updateSandboxUI(pred, contrib) {
        // Churn Progress meter
        const churnP = pred.churn_prob;
        const churnPercentText = `${(churnP * 100).toFixed(1)}%`;
        churnProbPercent.innerText = churnPercentText;
        
        // Calculate offset (circumference = 314.16)
        const churnOffset = 314.16 - (churnP * 314.16);
        churnMeterBar.style.strokeDashoffset = churnOffset;
        
        // Risk Badge color matching
        churnRiskBadge.innerText = pred.churn_risk_band || 'Scoring';
        churnRiskBadge.className = 'prediction-status-label mt-2';
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

        // Cross-Sell Progress meter
        const csP = pred.accept_prob;
        const csPercentText = `${(csP * 100).toFixed(1)}%`;
        csProbPercent.innerText = csPercentText;
        
        const csOffset = 314.16 - (csP * 314.16);
        csMeterBar.style.strokeDashoffset = csOffset;
        
        // Crosssell offer eligibility badge
        const isEligible = pred.crosssell_flag === 1;
        csAcceptBadge.innerText = `${pred.crosssell_prob_band || 'Scoring'}${isEligible ? ' / Target Offer' : ' / No Offer'}`;
        csAcceptBadge.className = 'prediction-status-label mt-2';
        if (isEligible) {
            csAcceptBadge.style.color = 'var(--color-emerald)';
            csAcceptBadge.style.borderColor = 'rgba(16,185,129,0.3)';
            csAcceptBadge.style.backgroundColor = '#ecfdf5';
        } else {
            csAcceptBadge.style.color = 'var(--text-muted)';
            csAcceptBadge.style.borderColor = 'var(--color-divider)';
            csAcceptBadge.style.backgroundColor = '#f8fafc';
        }

        // Render Local Drivers Explainer horizontal bar lists
        renderDriversList(churnDriversList, contrib.drivers, 'driver');
        renderDriversList(churnRestrainersList, contrib.restrainers, 'restrainer');
    }

    function renderDriversList(container, list, type) {
        container.innerHTML = '';
        if (!list || list.length === 0) {
            container.innerHTML = `<div class="empty-state">No significant impact detected</div>`;
            return;
        }

        // Find max impact to scale bars relative to each other
        const maxVal = Math.max(...list.map(item => item.importance), 0.01);

        list.forEach(item => {
            const row = document.createElement('div');
            row.className = 'contrib-row';
            
            // Percentage width of the bar
            const percentWidth = Math.min((item.importance / maxVal) * 100, 100);
            
            row.innerHTML = `
                <div class="contrib-info">
                    <span class="contrib-name">${item.display_name}</span>
                    <span class="contrib-val ${type === 'driver' ? 'text-rose' : 'text-cyan'}">${item.contribution >= 0 ? '+' : ''}${item.contribution.toFixed(3)}</span>
                </div>
                <div class="contrib-bar-wrapper">
                    <div class="contrib-bar ${type}" style="width: ${percentWidth}%"></div>
                </div>
            `;
            container.appendChild(row);
        });
    }

    // --- Tab 4: Batch Scoring Logic ---

    // File Drop Zone Click
    dropZone.addEventListener('click', () => fileInput.click());

    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            handleSelectedFile(e.target.files[0]);
        }
    });

    // Drag and drop events
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
        
        // Reset results area
        batchEmptyState.style.display = 'flex';
        batchResultsContent.style.display = 'none';
    });

    // Execute scoring
    btnRunScoring.addEventListener('click', async () => {
        if (!selectedFile) return;

        // Setup Form Data
        const formData = new FormData();
        formData.append('file', selectedFile);
        
        if (overrideChurn.value) formData.append('churn_threshold', overrideChurn.value);
        if (overrideCs.value) formData.append('crosssell_threshold', overrideCs.value);

        // UI Loading State
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
            alert(`Scoring Error: ${error.message}`);
        } finally {
            scoringLoader.style.display = 'none';
            btnRunScoring.disabled = false;
            btnRemoveFile.disabled = false;
        }
    });

    function displayBatchResults(data) {
        batchEmptyState.style.display = 'none';
        batchResultsContent.style.display = 'block';

        // Update stats
        batchStatTotal.innerText = data.stats.total_rows.toLocaleString();
        batchStatChurn.innerText = data.stats.churn_flags.toLocaleString();
        batchStatChurnRate.innerText = `${(data.stats.churn_rate * 100).toFixed(1)}% rate`;
        batchStatCs.innerText = data.stats.crosssell_flags.toLocaleString();
        batchStatCsRate.innerText = `${(data.stats.crosssell_rate * 100).toFixed(1)}% rate`;

        // Update download button link
        btnDownloadScored.href = `/api/download/${data.file_key}`;

        // Populate preview table
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

    // --- Reload DB Button Event ---
    refreshBtn.addEventListener('click', () => {
        refreshBtn.classList.add('spinning');
        fetchSummary().finally(() => {
            setTimeout(() => refreshBtn.classList.remove('spinning'), 1000);
        });
    });

    // Add spinner style dynamically
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

    // --- On Load initialization ---
    fetchSummary();
    triggerAutoPredict(); // Run initial mock prediction on default inputs
});