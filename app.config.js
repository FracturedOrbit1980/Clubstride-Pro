const { expo } = require('./app.json');

// GitHub Pages serves the web build from <repo>/ on the domain root. Only the export
// sets this, so the local Metro server keeps serving from the origin root. The value is
// a bare repo name because Git Bash rewrites values that start with a slash.
module.exports = () => {
  const config = { ...expo };
  const repo = process.env.EXPO_WEB_BASE_REPO;
  if (repo) {
    config.experiments = { ...(config.experiments ?? {}), baseUrl: `/${repo.replace(/^\/+|\/+$/g, '')}` };
  }
  return config;
};
