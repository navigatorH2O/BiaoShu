function logInfo(...args) {
  console.log('[biaoshu-client]', ...args);
}

function logError(...args) {
  console.error('[biaoshu-client]', ...args);
}

module.exports = {
  logError,
  logInfo,
};
