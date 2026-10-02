module.exports = {
  PORT: 3000,
  HOST: '0.0.0.0',
  FRANCHISE_ID: 'pryme-vertex',
  DEFAULT_STORE_ID: 'buraza',
  STORES: [
    { id: 'buraza', name: 'Buraza Micro Finance', code: 'BMF', active: true }
  ],
  SHUTDOWN_KEY: process.env.MASTER_KEY || 'phirii26',
  LOGS: {
    ACCESS: 'logs/access.log',
    ERRORS: 'logs/errors.log'
  },
  TRUSTED_TOKENS: [
    'LAPTOP-Solojjktitazeckjomerali',
    'PHONE-Alimercjoezectitjjksolo'
  ]
};