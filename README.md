# TrakEx - Personal Expense Tracker

TrakEx is a simple, premium full-stack personal expense tracker built to operate under real-world conditions. 

## Features
- **Add Expenses**: Easily add your expenses with amount, category, date, and description.
- **Filter & Sort**: Filter expenses by category and sort them by date (Newest or Oldest first).
- **Dynamic Totals**: The summary card updates automatically to show the total sum of the currently visible expenses.
- **Resilient**: Robust retry handling. If the network drops or you accidentally click submit multiple times, the app will not create duplicate expense entries.

## Tech Stack
- **Backend**: Node.js, Express, SQLite
- **Frontend**: Vanilla HTML, CSS, JavaScript (served statically by Express)

## Key Design Decisions
1. **Idempotency for Retries**: The frontend generates a unique `idempotency_key` (UUID) when the form is rendered/submitted. The backend stores this key with the expense. If the user clicks submit multiple times, or if the network hangs and the browser retries the POST request, the backend simply returns the existing record instead of creating duplicates.
2. **Money Handling**: Currency is converted to cents (integers) before being sent to the backend. This prevents floating-point rounding errors when calculating totals and storing values in SQLite. It's converted back to floating-point formatting purely for display purposes on the frontend.
3. **Single Server Architecture**: To keep the setup simple and easy to run without requiring multiple terminal windows, the frontend consists of static files served directly by the Express backend.
4. **Premium Aesthetics**: The UI implements a dark-mode glassmorphic design utilizing CSS variables, flexbox, and CSS Grid for layout, avoiding heavy external CSS frameworks while maintaining a visually stunning experience.

## Trade-offs Made Due to Time Constraints
- **No User Authentication**: For simplicity, expenses are global. In a real application, user accounts and authentication (JWT/session) would be necessary to isolate data per user.
- **Basic SQLite Setup**: We use the basic `sqlite3` driver. For a large-scale production app, I would use an ORM (like Prisma) or a query builder (like Knex) and implement proper database migrations.
- **In-Memory Filtering/Sorting (Frontend vs Backend)**: Although the backend supports querying by category and sorting by date, some interactions (like calculating the total sum based on the *currently fetched* filter) are derived on the frontend from the API response for better responsiveness, rather than requiring separate aggregation API calls.
- **Lack of Pagination**: Currently, `GET /expenses` fetches all matching records. A production app would paginate this data.

## Running Locally

1. **Install dependencies**:
   ```bash
   npm install
   ```
2. **Start the server**:
   ```bash
   node server.js
   ```
3. **View the application**:
   Open `http://localhost:3000` in your web browser.
