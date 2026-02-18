module.exports = {
    apps: [
        {
            name: "radiant-aura-backend",
            script: "./dist/server.js",
            instances: "max",
            exec_mode: "cluster",
            env: {
                NODE_ENV: "production",
                PORT: 5000
            }
        }
    ]
};
