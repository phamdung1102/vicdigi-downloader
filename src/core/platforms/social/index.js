'use strict';

const { downloadFacebook } = require('../../../services/social/facebook');
const { downloadInstagram } = require('../../../services/social/instagram');
const { downloadTikTok } = require('../../../services/social/tiktok');

module.exports = {
  downloadFacebook,
  downloadInstagram,
  downloadTikTok,
};
