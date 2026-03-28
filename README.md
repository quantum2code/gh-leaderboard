# gh-leaderboard

## Features

- **TypeScript** - For type safety and improved developer experience
- **Next.js** - Full-stack React framework
- **TailwindCSS** - Utility-first CSS for rapid UI development
- **Shared UI package** - shadcn/ui primitives live in `packages/ui`
- **tRPC** - End-to-end type-safe APIs
- **Drizzle** - TypeScript-first ORM
- **SQLite/Turso** - Database engine
- **Authentication** - Better-Auth

## Getting Started

First, install the dependencies:

```bash
pnpm install
```

## Database Setup

This project uses SQLite with Drizzle ORM.

1. Start the local SQLite database (optional):

```bash
pnpm run db:local
```

2. Update your `.env` file in the `apps/web` directory with the appropriate connection details if needed.

3. Apply the schema to your database:

```bash
pnpm run db:push
```

Then, run the development server:

```bash
pnpm run dev
```

Open [http://localhost:3001](http://localhost:3001) in your browser to see the fullstack application.

Uses ngrok reverse proxy for dev testing of webhooks

```bash
npx ngrok http 3001
```

## Project Structure

```
gh-leaderboard/
├── apps/
│   └── web/               # Fullstack application (Next.js)
├── packages/
│   ├── ui/                # Shared shadcn/ui components and styles
│   ├── api/               # API layer / business logic
|       └── webhook/github # github webhook
│   ├── auth/              # Authentication configuration & logic
│   └── db/                # Database schema & queries
```
In `.env` you need to provide:

`GITHUB_WEBHOOK_SECRET`
`INNGEST_EVENT_KEY`
`INNGEST_SIGNING_KEY`

## Available Scripts

- `pnpm run dev`: Start all applications in development mode
- `pnpm run build`: Build all applications
- `pnpm run dev:web`: Start only the web application
- `pnpm run check-types`: Check TypeScript types across all apps
- `pnpm run db:push`: Push schema changes to database
- `pnpm run db:generate`: Generate database client/types
- `pnpm run db:migrate`: Run database migrations
- `pnpm run db:studio`: Open database studio UI
- `pnpm run db:local`: Start the local SQLite database
