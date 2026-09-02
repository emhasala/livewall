const noop = { attach: () => true, reassert: () => true, foregroundIsFullscreen: () => false };

module.exports =
  process.platform === 'darwin' ? require('./mac')
  : process.platform === 'win32' ? require('./win')
  : noop;
