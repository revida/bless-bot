const winston = require("winston");
const colors = require("./colors");
const customLevels = {
  levels: {
    error: 0,
    warn: 1,
    info: 2,
    success: 3,
    custom: 4 
  },
  colors: {
    error: "red",
    warn: "yellow",
    info: "cyan",
    success: "green",
    custom: "magenta"
  }
};


const customFormat = winston.format.combine(
  winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
  winston.format.printf(({ timestamp, level, message }) => {
    const levelColors = {
      error: colors.error,
      warn: colors.warning,
      info: colors.info,
      success: colors.success,
      custom: colors.custom
    };
    const date = timestamp.split(" ")[0];
    const time = timestamp.split(" ")[1];

    return `BLESS NETWORK | DATE: ${colors.brightCyan}${date}${colors.reset} | TIME: ${colors.brightCyan}${time}${colors.reset} | ` +
           `${levelColors[level]}${level.toUpperCase().padEnd(7)}${colors.reset} | ` +
           `${message}`;
  })
);
const logger = winston.createLogger({
  levels: customLevels.levels,
  level: "custom",
  format: customFormat,
  transports: [new winston.transports.Console()]
});
winston.addColors(customLevels.colors);

module.exports = logger;
