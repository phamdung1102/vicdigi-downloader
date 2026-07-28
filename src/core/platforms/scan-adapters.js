'use strict';

const { detectPlatform } = require('./detect-platform');
const generic = require('./generic/generic-scan');
const youtube = require('./youtube/youtube-scan');
const tiktok = require('./tiktok/tiktok-scan');
const instagram = require('./instagram/instagram-scan');
const facebook = require('./facebook/facebook-scan');
const hongguo = require('./hongguo/hongguo-scan');

function resolveScanAdapter(url) {
  switch (detectPlatform(url)) {
    case 'youtube':
      return youtube;
    case 'tiktok':
      return tiktok;
    case 'instagram':
      return instagram;
    case 'facebook':
      return facebook;
    case 'hongguo':
      return hongguo;
    default:
      return generic;
  }
}

module.exports = {
  resolveScanAdapter,
};
