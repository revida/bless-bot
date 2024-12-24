const fs = require('fs');
const axios = require("axios");
const colors = require('./config/colors.js');
const logger = require('./config/logger.js');

const Utils = {
  sleep: (ms) => new Promise(resolve => setTimeout(resolve, ms)),
  getTimestamp: () => new Date().toISOString(),
  truncateString: (str, length) => str ? str.substr(0, length) + "..." : "unknown",
  parseJwt: (token) => {
    try {
      const payload = token.split('.')[1];
      const decoded = Buffer.from(payload, 'base64').toString('utf8');
      return JSON.parse(decoded);
    } catch (error) {
      return null;
    }
  },
  formatDate: (timestamp) => {
    const date = new Date(timestamp * 1000);
    return date.toLocaleString('en-US', {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: '2-digit',
      hour12: false
    });
  }
};

class ApiClient {
  constructor(baseURL) {
    this.client = axios.create({
      baseURL,
      timeout: 30000
    });

    this.client.interceptors.request.use((config) => {
      if (config.headers.Authorization) {
        const token = config.headers.Authorization.split(" ")[1];
        if (token) Utils.parseJwt(token);
      }
      return config;
    }, (error) => Promise.reject(error));

    this.client.interceptors.response.use(
      (response) => response,
      async (error) => {
        if (error.response) {
          const { status, data } = error.response;
          throw new Error(`API Error: ${status} - ${JSON.stringify(data)}`);
        }
        throw error;
      }
    );
  }

  async healthCheck() {
    try {
      const response = await this.makeRequest("get", "/health");
      return response.status === 'ok';
    } catch (error) {
      logger.error(`${colors.error}Health check failed: ${error.message}${colors.reset}`);
      return false;
    }
  }

  async makeRequest(method, url, data = null, headers = {}, retries = 0) {
    try {
      const response = await this.client({ method, url, data, headers });
      return response.data;
    } catch (error) {
      if (retries < 3) {
        logger.warn(`${colors.warning}Request failed, retrying (${retries + 1}/3)...${colors.reset}`);
        await Utils.sleep(5000);
        return this.makeRequest(method, url, data, headers, retries + 1);
      }
      throw error;
    }
  }
}

class AccountManager {
  constructor() {
    this.accounts = [];
  }

  loadAccounts() {
    try {
      const data = fs.readFileSync("data.txt", 'utf8');
      this.accounts = data.split("\n").map(line => line.trim()).filter(line => line);
      logger.success(`${colors.success}Loaded ${this.accounts.length} accounts${colors.reset}`);
      return true;
    } catch (error) {
      logger.error(`${colors.error}Error loading accounts: ${error.message}${colors.reset}`);
      return false;
    }
  }

  getAccounts() {
    return this.accounts;
  }
}

class NodeManager {
  constructor(apiClient) {
    this.apiClient = apiClient;
  }

  async getNodes(token) {
    try {
      return await this.apiClient.makeRequest("get", "/api/v1/nodes", null, {
        Authorization: `Bearer ${token}`,
        Accept: "application/json"
      });
    } catch (error) {
      logger.error(`${colors.error}Failed to get nodes: ${error.message}${colors.reset}`);
      return [];
    }
  }

  async pingNode(token, nodeId) {
    try {
      const response = await this.apiClient.makeRequest("post", `/api/v1/nodes/${nodeId}/ping`, {}, {
        Authorization: `Bearer ${token}`,
        Accept: "application/json"
      });
      return response.status === 'ok';
    } catch (error) {
      logger.error(`${colors.error}Failed to ping node: ${error.message}${colors.reset}`);
      return false;
    }
  }
}

class PingAutomation {
  constructor() {
    this.apiClient = new ApiClient("https://gateway-run.bls.dev");
    this.accountManager = new AccountManager();
    this.nodeManager = new NodeManager(this.apiClient);
    this.isRunning = false;
  }

  async performHealthCheck() {
    logger.info(`${colors.info}Performing health check...${colors.reset}`);
    const isHealthy = await this.apiClient.healthCheck();
    if (!isHealthy) {
      logger.error(`${colors.error}Service is not healthy, skipping ping cycle${colors.reset}`);
      return false;
    }
    logger.success(`${colors.success}Health check passed${colors.reset}`);
    return true;
  }

  async processAccount(account) {
    const accountInfo = Utils.parseJwt(account);
    const nodes = await this.nodeManager.getNodes(account);

    for (const node of nodes) {
      const nodeId = node.pubKey;
      const isSuccess = await this.nodeManager.pingNode(account, nodeId);
      const message = `${colors.accountInfo}Account: ${Utils.truncateString(account, 10)}${colors.reset} | ` +
                      `${colors.accountName}[UserID: ${accountInfo?.userId || "unknown"} | ` +
                      `Issued: ${Utils.formatDate(accountInfo?.iat)} | ` +
                      `Expires: ${Utils.formatDate(accountInfo?.exp)}]${colors.reset} | ` +
                      `${colors.custom}Node: ${Utils.truncateString(nodeId, 10)}${colors.reset} Ping: ` +
                      (isSuccess ? `${colors.success}Success` : `${colors.error}Failed`) +
                      `${colors.reset}`;

      if (isSuccess) {
        logger.success(message);
      } else {
        logger.error(message);
      }
    }
  }

  async start(intervalMinutes = 1) {
    if (this.isRunning) {
      logger.warn(`${colors.warning}Automation is already running${colors.reset}`);
      return;
    }

    if (!this.accountManager.loadAccounts()) {
      logger.error(`${colors.error}Failed to load accounts, stopping automation${colors.reset}`);
      return;
    }

    this.isRunning = true;
    logger.info(`${colors.info}Starting ping automation with ${colors.brightCyan}${intervalMinutes}${colors.info} minute interval${colors.reset}`);

    while (this.isRunning) {
      const isHealthy = await this.performHealthCheck();
      if (!isHealthy) {
        await Utils.sleep(10000);
        continue;
      }

      for (const account of this.accountManager.getAccounts()) {
        try {
          await this.processAccount(account);
        } catch (error) {
          logger.error(`${colors.error}Error processing account: ${error.message}${colors.reset}`);
        }
      }

      await Utils.sleep(intervalMinutes * 60 * 1000);
    }
  }

  stop() {
    this.isRunning = false;
    logger.warn(`${colors.warning}Stopping ping automation${colors.reset}`);
  }
}

async function main() {
  const automation = new PingAutomation();

  process.on("SIGINT", () => {
    automation.stop();
    process.exit(0);
  });

  process.on('uncaughtException', (error) => {
    logger.error(`${colors.error}Uncaught Exception: ${error.message}${colors.reset}`);
    automation.stop();
    process.exit(1);
  });

  process.on("unhandledRejection", (reason, promise) => {
    logger.error(`${colors.error}Unhandled Rejection at: ${promise}, reason: ${reason}${colors.reset}`);
    automation.stop();
    process.exit(1);
  });

  await automation.start();
}

main().catch((error) => {
  logger.error(`${colors.error}Fatal error: ${error.message}${colors.reset}`);
  process.exit(1);
});
