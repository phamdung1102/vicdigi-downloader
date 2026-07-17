'use strict';

const { downloadInstagram } = require('./instagram');
const { downloadTikTok } = require('./tiktok');
const { downloadFacebook } = require('./facebook');

module.exports = {
  downloadInstagram,
  downloadTikTok,
  downloadFacebook,
};
