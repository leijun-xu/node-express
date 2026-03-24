import log4js from 'log4js';

// 配置 log4js
log4js.configure({
  appenders: {
    console: {
      type: 'console',
      layout: {
        type: 'pattern',
        pattern: '[%d{yyyy-MM-dd hh:mm:ss}] [%p] - %m'
      }
    },
    file: {
      type: 'file',
      filename: 'logs/app.log',
      layout: {
        type: 'pattern',
        pattern: '[%d{yyyy-MM-dd hh:mm:ss}] [%p] - %m'
      }
    }
  },
  categories: {
    default: {
      appenders: ['console', 'file'],
      level: 'debug'
    }
  }
});

export const logger = log4js.getLogger('API');
