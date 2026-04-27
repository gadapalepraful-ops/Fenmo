document.addEventListener('DOMContentLoaded', () => {
    const themeToggleBtn = document.getElementById('theme-toggle');
    const themeIcon = document.getElementById('theme-icon');

    // Theme initialization
    const savedTheme = localStorage.getItem('trakex-theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    let currentTheme = savedTheme ? savedTheme : (prefersDark ? 'dark' : 'light');

    const applyTheme = (theme) => {
        document.documentElement.setAttribute('data-theme', theme);
        themeIcon.textContent = theme === 'dark' ? '☀️' : '🌙';
    };

    applyTheme(currentTheme);

    themeToggleBtn.addEventListener('click', () => {
        currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
        localStorage.setItem('trakex-theme', currentTheme);
        applyTheme(currentTheme);
    });
    const form = document.getElementById('expense-form');
    const amountInput = document.getElementById('amount');
    const categoryInput = document.getElementById('category');
    const dateInput = document.getElementById('date');
    const descInput = document.getElementById('description');
    const submitBtn = document.getElementById('submit-btn');
    const formError = document.getElementById('form-error');
    const formSuccess = document.getElementById('form-success');
    const submitText = form.querySelector('.btn-text');
    const submitLoader = form.querySelector('.loader');

    const expensesListEl = document.getElementById('expenses-list');
    const listLoader = document.getElementById('list-loader');
    const listError = document.getElementById('list-error');
    const emptyState = document.getElementById('empty-state');
    const totalDisplay = document.getElementById('total-display');
    const categorySummaryList = document.getElementById('category-summary-list');

    const filterCategory = document.getElementById('filter-category');
    const sortDate = document.getElementById('sort-date');
    const filterStartDate = document.getElementById('filter-start-date');
    const filterEndDate = document.getElementById('filter-end-date');

    // Base API URL
    const API_URL = '/expenses';
    let currentIdempotencyKey = uuid.v4();
    let currentExpenses = [];
    let knownCategories = new Set();
    let editingExpenseId = null;

    // Init Date to today in DD-MM-YYYY
    const todayIso = new Date().toISOString().split('T')[0];
    const [ty, tm, td] = todayIso.split('-');
    dateInput.value = `${td}-${tm}-${ty}`;

    // Helper: wire a calendar icon btn → hidden date picker → text input
    const wireCalendar = (btnId, pickerId, textInput, onPick) => {
        const btn    = document.getElementById(btnId);
        const picker = document.getElementById(pickerId);
        if (!btn || !picker) return;

        // Make picker temporarily clickable when triggered
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            picker.style.pointerEvents = 'auto';
            picker.showPicker?.();
            picker.click();
        });

        picker.addEventListener('change', () => {
            if (!picker.value) return;
            const [y, m, d] = picker.value.split('-');
            textInput.value = `${d}-${m}-${y}`;
            picker.style.pointerEvents = 'none';
            if (onPick) onPick();
        });
    };

    wireCalendar('date-cal-btn',          'date-picker',          dateInput, null);
    wireCalendar('filter-start-cal-btn',  'filter-start-picker',  filterStartDate, () => fetchExpenses());
    wireCalendar('filter-end-cal-btn',    'filter-end-picker',    filterEndDate,   () => fetchExpenses());

    // Formatter
    const formatMoney = (cents) => {
        return '₹' + (cents / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    };

    const formatDate = (dateStr) => {
        const options = { year: 'numeric', month: 'short', day: 'numeric' };
        return new Date(dateStr).toLocaleDateString(undefined, options);
    };

    // Accepts: DD-MM-YYYY | DD/MM/YYYY | YYYY-MM-DD | D-M-YY | today | yesterday
    // Returns: YYYY-MM-DD string or null if invalid
    const parseDate = (str) => {
        if (!str || !str.trim()) return null;
        const s = str.trim().toLowerCase();
        if (s === 'today') {
            return new Date().toISOString().split('T')[0];
        }
        if (s === 'yesterday') {
            const d = new Date(); d.setDate(d.getDate() - 1);
            return d.toISOString().split('T')[0];
        }
        // Try DD-MM-YYYY or DD/MM/YYYY
        const dmy = s.match(/^(\d{1,2})[\-\/](\d{1,2})[\-\/](\d{2,4})$/);
        if (dmy) {
            let [, d, m, y] = dmy;
            if (y.length === 2) y = '20' + y;
            const date = new Date(`${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`);
            if (!isNaN(date)) return `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
        }
        // Try YYYY-MM-DD
        const ymd = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (ymd) return s;
        return null;
    };

    const renderList = (expenses) => {
        expensesListEl.innerHTML = '';
        
        if (expenses.length === 0) {
            expensesListEl.classList.add('hidden');
            emptyState.classList.remove('hidden');
            totalDisplay.textContent = '₹0.00';
            return;
        }

        expensesListEl.classList.remove('hidden');
        emptyState.classList.add('hidden');

        let totalCents = 0;

        expenses.forEach(exp => {
            totalCents += exp.amount;
            knownCategories.add(exp.category);

            const li = document.createElement('li');
            li.className = 'expense-item';
            li.innerHTML = `
                <div class="expense-info">
                    <span class="expense-category">${escapeHtml(exp.category)}</span>
                    <span class="expense-desc">${escapeHtml(exp.description || 'No description')}</span>
                    <span class="expense-date">${formatDate(exp.date)}</span>
                </div>
                <div style="display: flex; align-items: center; gap: 1rem;">
                    <div class="expense-amount">${formatMoney(exp.amount)}</div>
                    <div class="expense-actions">
                        <button class="expense-actions-btn" data-action="toggle" data-id="${exp.id}">⋮</button>
                        <div id="menu-${exp.id}" class="expense-actions-menu hidden">
                            <button data-action="edit" data-id="${exp.id}">Edit</button>
                            <button class="delete-btn" data-action="delete" data-id="${exp.id}">Delete</button>
                        </div>
                    </div>
                </div>
            `;
            expensesListEl.appendChild(li);
        });

        totalDisplay.textContent = formatMoney(totalCents);
        updateCategoryFilterOptions();
        renderCategorySummary(expenses);
        renderMonthlyChart(expenses);
        renderYearlySummary(expenses);
    };

    const renderCategorySummary = (expenses) => {
        categorySummaryList.innerHTML = '';
        const summary = {};
        expenses.forEach(exp => {
            summary[exp.category] = (summary[exp.category] || 0) + exp.amount;
        });

        const sortedSummary = Object.entries(summary).sort((a, b) => b[1] - a[1]);
        
        sortedSummary.forEach(([cat, amount]) => {
            const li = document.createElement('li');
            li.className = 'summary-item';
            li.innerHTML = `
                <span class="summary-cat">${escapeHtml(cat)}</span>
                <span class="summary-amt">${formatMoney(amount)}</span>
            `;
            categorySummaryList.appendChild(li);
        });
    };

    let monthlyChart = null;
    let chartEndDate = new Date();
    const monthsToShow = 4;

    let yearlyChart = null;
    let chartEndYear = new Date().getFullYear();
    const yearsToShow = 4;

    const renderYearlySummary = (expenses) => {
        const ctx = document.getElementById('yearly-chart');
        if (!ctx) return;
        
        const summary = {};
        expenses.forEach(exp => {
            const year = exp.date.substring(0, 4);
            summary[year] = (summary[year] || 0) + exp.amount;
        });

        const labels = [];
        const data = [];

        for (let i = yearsToShow - 1; i >= 0; i--) {
            const y = chartEndYear - i;
            labels.push(y.toString());
            data.push((summary[y.toString()] || 0) / 100);
        }

        if (yearlyChart) {
            yearlyChart.data.labels = labels;
            yearlyChart.data.datasets[0].data = data;
            yearlyChart.update();
        } else {
            yearlyChart = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: labels,
                    datasets: [{
                        label: 'Yearly Expenses (₹)',
                        data: data,
                        backgroundColor: 'rgba(99, 102, 241, 0.6)',
                        borderColor: 'rgba(99, 102, 241, 1)',
                        borderWidth: 1,
                        borderRadius: 4,
                        maxBarThickness: 40
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false }
                    },
                    scales: {
                        x: {
                            grid: { display: false }
                        },
                        y: {
                            beginAtZero: true,
                            min: 0,
                            ticks: {
                                callback: function(value) { return '₹' + value; }
                            }
                        }
                    }
                }
            });
        }
    };

    const renderMonthlyChart = (expenses) => {
        const ctx = document.getElementById('monthly-chart');
        if (!ctx) return;

        const labels = [];
        const data = [];

        // Generate last N months ending at chartEndDate
        for (let i = monthsToShow - 1; i >= 0; i--) {
            const d = new Date(chartEndDate.getFullYear(), chartEndDate.getMonth() - i, 1);
            const monthStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            const label = d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
            
            const total = expenses.reduce((sum, exp) => {
                if (exp.date.startsWith(monthStr)) {
                    return sum + exp.amount;
                }
                return sum;
            }, 0);
            
            labels.push(label);
            data.push(total / 100);
        }

        if (monthlyChart) {
            monthlyChart.data.labels = labels;
            monthlyChart.data.datasets[0].data = data;
            monthlyChart.update();
        } else {
            monthlyChart = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: labels,
                    datasets: [{
                        label: 'Expenses (₹)',
                        data: data,
                        backgroundColor: 'rgba(99, 102, 241, 0.6)',
                        borderColor: 'rgba(99, 102, 241, 1)',
                        borderWidth: 1,
                        borderRadius: 4,
                        maxBarThickness: 40
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false }
                    },
                    scales: {
                        x: {
                            grid: { display: false }
                        },
                        y: {
                            beginAtZero: true,
                            min: 0,
                            ticks: {
                                callback: function(value) { return '₹' + value; }
                            }
                        }
                    }
                }
            });
        }
    };

    document.getElementById('chart-prev').addEventListener('click', () => {
        chartEndDate.setMonth(chartEndDate.getMonth() - 1);
        renderMonthlyChart(currentExpenses);
    });

    document.getElementById('chart-next').addEventListener('click', () => {
        chartEndDate.setMonth(chartEndDate.getMonth() + 1);
        renderMonthlyChart(currentExpenses);
    });

    // ── Custom Select Logic (Portal Pattern) ──
    // Moves each menu to <body> to escape all stacking contexts

    const closeAllCustomSelects = () => {
        document.querySelectorAll('.custom-select.open').forEach(w => w.classList.remove('open'));
        document.querySelectorAll('.cs-portal-menu.cs-open').forEach(m => m.classList.remove('cs-open'));
    };

    const positionPortalMenu = (trigger, menu) => {
        const rect = trigger.getBoundingClientRect();
        menu.style.top   = `${rect.bottom + 5}px`;
        menu.style.left  = `${rect.left}px`;
        menu.style.width = `${rect.width}px`;
    };

    const initCustomSelect = (wrapper, onChange) => {
        const trigger   = wrapper.querySelector('.custom-select-trigger');
        const menu      = wrapper.querySelector('.custom-select-menu');
        const valueEl   = wrapper.querySelector('.custom-select-value');
        const hidden    = wrapper.querySelector('input[type="hidden"]');
        const placeholder = valueEl?.dataset.placeholder || null;

        // Portal: move menu to body
        menu.classList.add('cs-portal-menu');
        document.body.appendChild(menu);

        if (placeholder && !hidden?.value) valueEl?.classList.add('placeholder');

        trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = wrapper.classList.contains('open');
            closeAllCustomSelects();
            if (!isOpen) {
                wrapper.classList.add('open');
                menu.classList.add('cs-open');
                positionPortalMenu(trigger, menu);
            }
        });

        menu.addEventListener('click', (e) => {
            const li = e.target.closest('li');
            if (!li) return;
            const val  = li.dataset.value;
            const text = li.textContent.trim();

            valueEl.textContent = (placeholder && !val) ? placeholder : text;
            valueEl.classList.toggle('placeholder', !!(placeholder && !val));

            if (hidden) {
                hidden.value = val;
                hidden.dispatchEvent(new Event('change'));
            }

            menu.querySelectorAll('li').forEach(el => el.classList.remove('selected'));
            li.classList.add('selected');

            closeAllCustomSelects();
            if (onChange) onChange(val);
        });
    };

    // Reposition on scroll / resize
    window.addEventListener('scroll', () => {
        document.querySelectorAll('.custom-select.open').forEach(wrapper => {
            const trigger = wrapper.querySelector('.custom-select-trigger');
            const menu    = document.querySelector(`.cs-portal-menu.cs-open`);
            if (trigger && menu) positionPortalMenu(trigger, menu);
        });
    }, true);
    window.addEventListener('resize', () => {
        document.querySelectorAll('.custom-select.open').forEach(wrapper => {
            const trigger = wrapper.querySelector('.custom-select-trigger');
            const menu    = document.querySelector(`.cs-portal-menu.cs-open`);
            if (trigger && menu) positionPortalMenu(trigger, menu);
        });
    });

    // Init form category dropdown
    const categoryDropdown = document.getElementById('category-dropdown');
    if (categoryDropdown) initCustomSelect(categoryDropdown, () => {});

    // Init sort dropdown
    const sortDropdown = document.getElementById('sort-date-dropdown');
    if (sortDropdown) initCustomSelect(sortDropdown, () => fetchExpenses());

    // Init filter-category dropdown
    const filterCatDropdown = document.getElementById('filter-category-dropdown');
    if (filterCatDropdown) initCustomSelect(filterCatDropdown, () => fetchExpenses());

    // Close on outside click
    document.addEventListener('click', closeAllCustomSelects);


    const updateCategoryFilterOptions = () => {
        const menu = document.getElementById('filter-category-menu');
        const hidden = document.getElementById('filter-category');
        const valueEl = filterCatDropdown?.querySelector('.custom-select-value');
        if (!menu) return;

        const currentVal = hidden?.value || '';
        menu.innerHTML = '<li data-value="" class="">All Categories</li>';
        const sortedCats = Array.from(knownCategories).sort();
        sortedCats.forEach(cat => {
            const li = document.createElement('li');
            li.dataset.value = cat;
            li.textContent = cat;
            if (cat === currentVal) li.classList.add('selected');
            menu.appendChild(li);
        });

        // Mark "All Categories" selected if no filter
        if (!currentVal) menu.querySelector('li')?.classList.add('selected');
    };

    const fetchExpenses = async () => {
        listLoader.classList.remove('hidden');
        expensesListEl.classList.add('hidden');
        emptyState.classList.add('hidden');
        listError.classList.add('hidden');

        try {
            const url = new URL(API_URL, window.location.origin);
            const startApiDate = parseDate(filterStartDate.value);
            const endApiDate   = parseDate(filterEndDate.value);
            if (filterCategory.value) url.searchParams.append('category', filterCategory.value);
            if (sortDate.value) url.searchParams.append('sort', sortDate.value);
            if (startApiDate) url.searchParams.append('start_date', startApiDate);
            if (endApiDate)   url.searchParams.append('end_date', endApiDate);

            const res = await fetch(url);
            if (!res.ok) throw new Error('Failed to fetch expenses');
            const data = await res.json();
            currentExpenses = data;
            renderList(data);
        } catch (err) {
            console.error(err);
            listError.textContent = 'Unable to load expenses. Please try again later.';
            listError.classList.remove('hidden');
        } finally {
            listLoader.classList.add('hidden');
        }
    };

    const submitExpense = async (e) => {
        e.preventDefault();
        
        // Reset states
        formError.classList.add('hidden');
        formSuccess.classList.add('hidden');
        submitBtn.disabled = true;
        submitText.classList.add('hidden');
        submitLoader.classList.remove('hidden');

        const amountVal = parseFloat(amountInput.value);
        if (isNaN(amountVal) || amountVal <= 0) {
            showError('Please enter a valid positive amount.');
            return;
        }

        const categoryVal = categoryInput.value.trim();
        if (!categoryVal) {
            showError('Please select a category.');
            submitBtn.disabled = false;
            submitText.classList.remove('hidden');
            submitLoader.classList.add('hidden');
            return;
        }

        const parsedDate = parseDate(dateInput.value);
        if (!parsedDate) {
            showError('Invalid date. Use DD-MM-YYYY (e.g. 27-04-2026).');
            submitBtn.disabled = false;
            submitText.classList.remove('hidden');
            submitLoader.classList.add('hidden');
            return;
        }

        const payload = {
            amount: Math.round(amountVal * 100), // convert to cents
            category: categoryVal,
            date: parsedDate,
            description: descInput.value.trim(),
            idempotency_key: currentIdempotencyKey
        };

        try {
            const url = editingExpenseId ? `${API_URL}/${editingExpenseId}` : API_URL;
            const method = editingExpenseId ? 'PUT' : 'POST';
            const res = await fetch(url, {
                method: method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || 'Failed to save expense');
            }

            // Success
            formSuccess.textContent = editingExpenseId ? 'Expense updated!' : 'Expense added!';
            formSuccess.classList.remove('hidden');
            form.reset();
            const nowIso = new Date().toISOString().split('T')[0];
            const [ny, nm, nd] = nowIso.split('-');
            dateInput.value = `${nd}-${nm}-${ny}`;

            // Reset custom category dropdown
            const catDropdown = document.getElementById('category-dropdown');
            if (catDropdown) {
                const valEl = catDropdown.querySelector('.custom-select-value');
                const hiddenEl = catDropdown.querySelector('input[type="hidden"]');
                if (valEl) { valEl.textContent = 'Select a category'; valEl.classList.add('placeholder'); }
                if (hiddenEl) hiddenEl.value = '';
                catDropdown.querySelectorAll('.custom-select-menu li').forEach(li => li.classList.remove('selected'));
            }
            
            if (editingExpenseId) {
                editingExpenseId = null;
                submitText.textContent = 'Add';
            } else {
                currentIdempotencyKey = uuid.v4();
            }
            
            // Refresh list
            fetchExpenses();

            setTimeout(() => {
                formSuccess.classList.add('hidden');
            }, 3000);

        } catch (err) {
            console.error(err);
            showError(err.message || 'Network error. Please try again.');
        } finally {
            submitBtn.disabled = false;
            submitText.classList.remove('hidden');
            submitLoader.classList.add('hidden');
        }
    };

    const showError = (msg) => {
        formError.textContent = msg;
        formError.classList.remove('hidden');
        submitBtn.disabled = false;
        submitText.classList.remove('hidden');
        submitLoader.classList.add('hidden');
    };

    const escapeHtml = (unsafe) => {
        return (unsafe || '').toString()
             .replace(/&/g, "&amp;")
             .replace(/</g, "&lt;")
             .replace(/>/g, "&gt;")
             .replace(/"/g, "&quot;")
             .replace(/'/g, "&#039;");
    };

    // Event Listeners
    form.addEventListener('submit', submitExpense);
    filterStartDate.addEventListener('change', fetchExpenses);
    filterEndDate.addEventListener('change', fetchExpenses);

    // Document click for closing expense action menus
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.expense-actions')) {
            document.querySelectorAll('.expense-actions-menu').forEach(menu => {
                menu.classList.add('hidden');
            });
        }
    });

    // Delegate clicks for the expense list actions
    expensesListEl.addEventListener('click', async (e) => {
        const actionBtn = e.target.closest('button[data-action]');
        if (!actionBtn) return;

        const action = actionBtn.getAttribute('data-action');
        const id = actionBtn.getAttribute('data-id');

        if (action === 'toggle') {
            document.querySelectorAll('.expense-actions-menu').forEach(menu => {
                if (menu.id !== `menu-${id}`) menu.classList.add('hidden');
            });
            const menu = document.getElementById(`menu-${id}`);
            if (menu) menu.classList.toggle('hidden');
        } else if (action === 'edit') {
            const exp = currentExpenses.find(e => e.id === id);
            if (exp) {
                const li = actionBtn.closest('.expense-item');
                li.innerHTML = `
                    <div class="expense-info inline-edit" style="width: 100%; display: flex; flex-direction: column; gap: 0.5rem; padding-right: 1rem;">
                        <select id="edit-cat-${exp.id}" style="padding: 0.5rem; background: var(--input-bg); border: 1px solid var(--card-border); border-radius: 4px; font-size: 0.8rem; text-transform: uppercase; font-weight: 600; letter-spacing: 0.05em; color: var(--primary);">
                            ${['Housing', 'Transportation', 'Food & Dining', 'Shopping', 'Utilities', 'Entertainment', 'Healthcare', 'Personal', 'Education', 'Food', 'Others'].map(c => 
                                `<option value="${c}" ${c.toLowerCase() === exp.category.toLowerCase() ? 'selected' : ''}>${c}</option>`
                            ).join('')}
                            ${!['Housing', 'Transportation', 'Food & Dining', 'Shopping', 'Utilities', 'Entertainment', 'Healthcare', 'Personal', 'Education', 'Food', 'Others'].map(c=>c.toLowerCase()).includes(exp.category.toLowerCase()) ? `<option value="${escapeHtml(exp.category)}" selected>${escapeHtml(exp.category)}</option>` : ''}
                        </select>
                        <input type="text" id="edit-desc-${exp.id}" value="${escapeHtml(exp.description || '')}" placeholder="Description" style="padding: 0.5rem; background: var(--input-bg); border: 1px solid var(--card-border); color: var(--text-main); border-radius: 4px; font-weight: 500; font-size: 1rem;">
                        <input type="date" id="edit-date-${exp.id}" value="${exp.date}" style="padding: 0.5rem; background: var(--input-bg); border: 1px solid var(--card-border); color: var(--text-muted); border-radius: 4px; font-size: 0.9rem;">
                    </div>
                    <div style="display: flex; flex-direction: column; align-items: flex-end; justify-content: space-between;">
                        <input type="number" id="edit-amt-${exp.id}" value="${(exp.amount / 100).toFixed(2)}" step="0.01" style="padding: 0.5rem; background: var(--input-bg); border: 1px solid var(--card-border); color: var(--text-main); border-radius: 4px; font-weight: 700; font-size: 1.25rem; width: 140px; text-align: right; margin-bottom: 0.75rem;">
                        <div style="display: flex; gap: 0.5rem;">
                            <button class="btn-primary" data-action="save-edit" data-id="${exp.id}" style="padding: 0.5rem 1rem; font-size: 0.9rem; border-radius: 6px; min-width: 70px;">Save</button>
                            <button class="btn-secondary" data-action="cancel-edit" style="padding: 0.5rem 1rem; font-size: 0.9rem; border-radius: 6px; background: transparent; color: var(--text-main); border: 1px solid var(--card-border); min-width: 70px;">Cancel</button>
                        </div>
                    </div>
                `;
                
                // Close menu
                const menu = document.getElementById(`menu-${id}`);
                if (menu) menu.classList.add('hidden');
            }
        } else if (action === 'cancel-edit') {
            renderList(currentExpenses);
        } else if (action === 'save-edit') {
            const newCat = document.getElementById(`edit-cat-${id}`).value.trim();
            const newDesc = document.getElementById(`edit-desc-${id}`).value.trim();
            const newDate = document.getElementById(`edit-date-${id}`).value;
            const newAmt = parseFloat(document.getElementById(`edit-amt-${id}`).value);

            if (!newCat || !newDate || isNaN(newAmt) || newAmt <= 0) {
                alert('Please provide valid category, date, and positive amount.');
                return;
            }

            const payload = {
                amount: Math.round(newAmt * 100),
                category: newCat,
                date: newDate,
                description: newDesc
            };

            const originalBtnText = actionBtn.textContent;
            actionBtn.textContent = '...';
            actionBtn.disabled = true;

            try {
                const res = await fetch(`${API_URL}/${id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                if (!res.ok) {
                    const text = await res.text();
                    throw new Error(`Server returned ${res.status}: ${text}`);
                }
                fetchExpenses();
            } catch (err) {
                console.error(err);
                alert('Error updating expense: ' + err.message);
                actionBtn.textContent = originalBtnText;
                actionBtn.disabled = false;
            }
        } else if (action === 'delete') {
            const modal = document.getElementById('delete-modal');
            const confirmBtn = document.getElementById('confirm-delete-btn');
            const cancelBtn = document.getElementById('cancel-delete-btn');
            
            modal.classList.remove('hidden');
            
            const handleConfirm = async () => {
                cleanup();
                try {
                    const res = await fetch(`${API_URL}/${id}`, { method: 'DELETE' });
                    if (!res.ok) {
                        const text = await res.text();
                        throw new Error(`Server returned ${res.status}: ${text}`);
                    }
                    fetchExpenses();
                } catch (err) {
                    console.error(err);
                    alert('Error deleting expense: ' + err.message);
                }
            };
            
            const handleCancel = () => {
                cleanup();
            };
            
            const cleanup = () => {
                modal.classList.add('hidden');
                confirmBtn.removeEventListener('click', handleConfirm);
                cancelBtn.removeEventListener('click', handleCancel);
            };
            
            confirmBtn.addEventListener('click', handleConfirm);
            cancelBtn.addEventListener('click', handleCancel);
        }
    });

    // Chart Navigation Event Listeners
    document.getElementById('chart-prev')?.addEventListener('click', () => {
        chartEndDate.setMonth(chartEndDate.getMonth() - 1);
        renderMonthlyChart(currentExpenses);
    });

    document.getElementById('chart-next')?.addEventListener('click', () => {
        chartEndDate.setMonth(chartEndDate.getMonth() + 1);
        renderMonthlyChart(currentExpenses);
    });

    document.getElementById('yearly-prev')?.addEventListener('click', () => {
        chartEndYear--;
        renderYearlySummary(currentExpenses);
    });

    document.getElementById('yearly-next')?.addEventListener('click', () => {
        chartEndYear++;
        renderYearlySummary(currentExpenses);
    });

    // Initial Load
    fetchExpenses();
});
