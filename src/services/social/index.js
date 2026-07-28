'use strict';

const { downloadInstagram } = require('./instagram');
const { downloadTikTok } = require('./tiktok');
const { downloadFacebook } = require('./facebook');
const { downloadHongguo } = require('./hongguo');

module.exports = {
  downloadInstagram,
  downloadTikTok,
  downloadFacebook,
  downloadHongguo,
};
