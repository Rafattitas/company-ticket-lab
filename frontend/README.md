# TicketDesk — Frontend

React and Vite dashboard for creating, filtering, assigning, prioritizing, and
updating support tickets.

## Build

The Dockerfile uses Node.js to run `npm ci` and `npm run build`.
The final image contains Nginx and the generated static files only.

## Request routing

- `/` serves the React application.
- `/api/` is forwarded by Nginx to the backend service.

Nginx listens on port 8080 inside the container. The published host
address and port are configured in `deploy/compose.yaml`.
