const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Initialize SQLite database
const db = new sqlite3.Database('./expenses.db', (err) => {
    if (err) {
        console.error('Error opening database', err.message);
    } else {
        console.log('Connected to the SQLite database.');
        db.run(`
            CREATE TABLE IF NOT EXISTS expenses (
                id TEXT PRIMARY KEY,
                amount INTEGER NOT NULL,
                category TEXT NOT NULL,
                description TEXT,
                date TEXT NOT NULL,
                created_at TEXT NOT NULL,
                idempotency_key TEXT UNIQUE
            )
        `);
    }
});

// Helper function to run DB queries with promises
const runQuery = (sql, params = []) => {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
            if (err) reject(err);
            else resolve(this);
        });
    });
};

const getQuery = (sql, params = []) => {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
};

const getSingle = (sql, params = []) => {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
};

// POST /expenses
app.post('/expenses', async (req, res) => {
    const { amount, category, description, date, idempotency_key } = req.body;

    // Basic validation
    if (!amount || amount <= 0) {
        return res.status(400).json({ error: 'Valid amount > 0 is required (in cents).' });
    }
    if (!category) {
        return res.status(400).json({ error: 'Category is required.' });
    }
    if (!date) {
        return res.status(400).json({ error: 'Date is required.' });
    }

    try {
        // Handle idempotency
        if (idempotency_key) {
            const existing = await getSingle('SELECT * FROM expenses WHERE idempotency_key = ?', [idempotency_key]);
            if (existing) {
                return res.status(200).json(existing);
            }
        }

        const id = uuidv4();
        const created_at = new Date().toISOString();

        await runQuery(
            'INSERT INTO expenses (id, amount, category, description, date, created_at, idempotency_key) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [id, amount, category, description, date, created_at, idempotency_key || null]
        );

        const newExpense = await getSingle('SELECT * FROM expenses WHERE id = ?', [id]);
        res.status(201).json(newExpense);
    } catch (err) {
        console.error('Error creating expense:', err);
        // SQLite constraint violation (e.g. unique idempotency_key race condition)
        if (err.message.includes('UNIQUE constraint failed: expenses.idempotency_key')) {
             const existing = await getSingle('SELECT * FROM expenses WHERE idempotency_key = ?', [idempotency_key]);
             if (existing) return res.status(200).json(existing);
        }
        res.status(500).json({ error: 'Internal server error.' });
    }
});

// GET /expenses
app.get('/expenses', async (req, res) => {
    const { category, sort, start_date, end_date } = req.query;
    
    let sql = 'SELECT * FROM expenses';
    const params = [];
    const conditions = [];
    
    if (category) {
        conditions.push('category = ?');
        params.push(category);
    }
    if (start_date) {
        conditions.push('date >= ?');
        params.push(start_date);
    }
    if (end_date) {
        conditions.push('date <= ?');
        params.push(end_date);
    }
    
    if (conditions.length > 0) {
        sql += ' WHERE ' + conditions.join(' AND ');
    }
    
    if (sort === 'date_desc') {
        sql += ' ORDER BY date DESC, created_at DESC';
    } else if (sort === 'date_asc') {
        sql += ' ORDER BY date ASC, created_at ASC';
    } else {
        // default sort
        sql += ' ORDER BY date DESC, created_at DESC';
    }

    try {
        const expenses = await getQuery(sql, params);
        res.status(200).json(expenses);
    } catch (err) {
        console.error('Error fetching expenses:', err);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

// GET /expenses/summary (Nice to Have)
app.get('/expenses/summary', async (req, res) => {
    try {
        const summary = await getQuery('SELECT category, SUM(amount) as total FROM expenses GROUP BY category');
        res.status(200).json(summary);
    } catch (err) {
         console.error('Error fetching summary:', err);
         res.status(500).json({ error: 'Internal server error.' });
    }
});

// DELETE /expenses/:id
app.delete('/expenses/:id', async (req, res) => {
    const { id } = req.params;
    try {
        await runQuery('DELETE FROM expenses WHERE id = ?', [id]);
        res.status(204).send();
    } catch (err) {
        console.error('Error deleting expense:', err);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

// PUT /expenses/:id
app.put('/expenses/:id', async (req, res) => {
    const { id } = req.params;
    const { amount, category, description, date } = req.body;
    
    if (!amount || amount <= 0) {
        return res.status(400).json({ error: 'Valid amount > 0 is required (in cents).' });
    }
    if (!category) {
        return res.status(400).json({ error: 'Category is required.' });
    }
    if (!date) {
        return res.status(400).json({ error: 'Date is required.' });
    }

    try {
        await runQuery(
            'UPDATE expenses SET amount = ?, category = ?, description = ?, date = ? WHERE id = ?',
            [amount, category, description, date, id]
        );
        const updatedExpense = await getSingle('SELECT * FROM expenses WHERE id = ?', [id]);
        if (!updatedExpense) {
            return res.status(404).json({ error: 'Expense not found.' });
        }
        res.status(200).json(updatedExpense);
    } catch (err) {
        console.error('Error updating expense:', err);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
