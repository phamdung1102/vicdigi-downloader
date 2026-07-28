'use strict';

const { downloadFacebook } = require('../../../services/social/facebook');
const { downloadInstagram } = require('../../../services/social/instagram');
const { downloadTikTok } = require('../../../services/social/tiktok');
const { downloadHongguo } = require('../../../services/social/hongguo');

module.exports = {
  downloadFacebook,
  downloadInstagram,
  downloadTikTok,
  downloadHongguo,
};
