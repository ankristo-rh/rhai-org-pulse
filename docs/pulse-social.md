# Pulse Social

Internal team feed for sharing updates, wins, learnings, questions, and milestones across the org.

## Overview

Pulse Social is a built-in module that gives engineering teams a lightweight, async communication channel. Unlike Slack (real-time, ephemeral) or email (formal, long), Pulse Social is designed for **durable team updates** — things worth knowing about days or weeks later.

### Use Cases

- **Wins**: Shipped a feature? Reduced latency? Closed a deal? Share it.
- **TIL (Today I Learned)**: Quick knowledge drops for the team.
- **Customer Success**: Demo feedback, enterprise adoption signals.
- **Questions**: Ask the team something without scheduling a meeting.
- **Milestones**: Version releases, roadmap completions, team achievements.

## Getting Started

### Enabling the Module

Pulse Social is disabled by default. Enable it via **Settings > Modules** or by setting it to `true` in `data/modules-state.json`:

```json
{
  "pulse-social": true
}
```

### First Use

On first startup, the module auto-seeds the database with sample posts demonstrating each label type. This gives new teams an immediate sense of what the feed looks like with real content.

## Architecture

```
modules/pulse-social/
├── module.json           # Module manifest
├── client/
│   ├── index.js          # Route definitions (feed, my-posts, post-detail)
│   ├── views/            # Page-level components
│   ├── components/       # UI components (PostCard, ReactionBar, etc.)
│   └── composables/      # Shared state (useFeed, useComposer, useReactions)
└── server/
    ├── index.js          # Express route registration
    ├── db.js             # SQLite connection (WAL mode)
    ├── posts.js          # Post CRUD + feed queries
    ├── comments.js       # Comment CRUD
    ├── reactions.js      # Reaction toggle logic
    ├── attachments.js    # File upload/serve
    ├── validation.js     # Input sanitization
    ├── rate-limiter.js   # Per-user rate limits
    ├── seed.js           # Sample data seeder
    └── migrations/       # SQL schema
```

### Storage

Unlike other modules that use JSON files, Pulse Social uses **SQLite** (via `better-sqlite3`) for performance with structured queries:

- **Production**: `data/pulse-social/feed.db` (WAL mode for concurrent reads)
- **Demo mode**: In-memory database with seed data (writes are no-ops)
- **Schema**: `posts`, `comments`, `reactions`, `mentions`, `attachments`, `posts_fts` (FTS5 full-text search)

### Auth Scopes

| Scope | Required For |
|-------|-------------|
| `pulse-social:read` | Viewing feed, posts, reactions |
| `pulse-social:write` | Creating posts, commenting, reacting, uploading |

Admin privileges are required for pinning posts.

## API Reference

All endpoints are prefixed with `/api/modules/pulse-social`.

### Posts

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/posts` | Paginated feed (supports `?label`, `?team`, `?author`, `?search`, `?before` cursor) |
| `GET` | `/posts/recent` | 5 most recent posts (for home widget) |
| `GET` | `/posts/:id` | Single post with comments, reactions, attachments |
| `POST` | `/posts` | Create post (`{ body, label?, mentions? }`) |
| `PUT` | `/posts/:id` | Edit own post |
| `DELETE` | `/posts/:id` | Delete post (author or admin) |

### Engagement

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/posts/:id/reactions` | Reaction details (who reacted with what) |
| `POST` | `/posts/:id/reactions` | Toggle reaction (`{ emoji }`) |
| `POST` | `/posts/:id/comments` | Add comment (`{ body }`) |
| `PUT` | `/posts/:id/comments/:commentId` | Edit own comment |
| `DELETE` | `/posts/:id/comments/:commentId` | Delete comment (author or admin) |

### Moderation

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/posts/:id/pin` | Pin/unpin post (admin only) |
| `POST` | `/posts/:id/resolve` | Mark question as resolved (author only) |

### Other

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/stats` | Feed usage statistics |
| `POST` | `/attachments` | Upload file (raw body, headers: `X-Filename`, `X-Post-Id`) |
| `GET` | `/attachments/:filename` | Serve uploaded file |

### Pagination

The feed uses **cursor-based pagination** via the `before` query parameter (ISO-8601 timestamp). Response shape:

```json
{
  "pinned": [...],
  "posts": [...],
  "nextCursor": "2025-01-15T10:30:00.000Z"
}
```

### Reactions

Supported emoji keys: `thumbsUp`, `heart`, `celebrate`, `insightful`, `curious`, `rocket`

Toggling a reaction is idempotent — POST the same emoji again to remove it.

## Rate Limits

| Action | Limit |
|--------|-------|
| Create post | 20 per user per hour |
| Add comment | 60 per user per hour |
| Toggle reaction | 200 per user per hour |
| Upload file | 30 per user per hour |

## File Attachments

- Max file size: **10 MB**
- Max storage per instance: **2 GB**
- Allowed types: JPEG, PNG, GIF, WebP, PDF, plain text, Markdown
- Files are validated by magic bytes (not just extension)
- Images are served inline; other files trigger download

## Demo Mode

When `DEMO_MODE=true`, all write operations return `{ success: true, demo: true }` without persisting data. Reads work normally against the seed database.

## Labels

| Key | Display | Use For |
|-----|---------|---------|
| `win` | Win | Shipped features, performance improvements, team achievements |
| `til` | TIL | Technical learnings, tips, discoveries |
| `customer-success` | Customer | Demo feedback, adoption signals, customer quotes |
| `question` | Question | Team questions (can be marked as resolved) |
| `milestone` | Milestone | Version releases, roadmap completions |

Posts without a label appear as general updates.

## UI Features

- **Three-column layout**: Feed center, activity sidebar right (on large screens)
- **Reaction picker**: Hover to preview, click to pin open; active reactions highlighted
- **Inline comments**: Expand on any post card without navigating away
- **Trending sidebar**: Shows label distribution with counts, clickable to filter
- **Post composer**: Markdown support with keyboard shortcuts (Ctrl+B, Ctrl+K, Ctrl+Enter)
- **Time grouping**: Posts grouped by Today / Yesterday / This Week / Earlier
- **Full-text search**: Queries run against FTS5 index on post body content
