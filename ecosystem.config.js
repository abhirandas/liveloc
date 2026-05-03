module.exports = {
  apps: [
    {
      name: "live-location-server",
      script: "pnpm",
      args: "start",
      cwd: "./server",
      interpreter: "none",
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "live-location-worker",
      script: "pnpm",
      args: "start",
      cwd: "./worker",
      interpreter: "none",
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
