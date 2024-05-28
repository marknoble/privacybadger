/*
 * This file is part of Privacy Badger <https://privacybadger.org/>
 * Copyright (C) 2024 Electronic Frontier Foundation
 *
 * Privacy Badger is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3 as
 * published by the Free Software Foundation.
 *
 * Privacy Badger is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with Privacy Badger.  If not, see <http://www.gnu.org/licenses/>.
 */

/* globals badger:false */

import sdb from "../../data/surrogates.js";

import { getBaseDomain } from "../../lib/basedomain.js";

import constants from "../../js/constants.js";
import mdfp from "../../js/multiDomainFirstParties.js";
import utils from "../../js/utils.js";

/**
 * Constructs a DNR rule object that blocks a domain and its subdomains.
 *
 * @param {Integer} id
 * @param {String} domain
 * @param {Integer} [priority]
 *
 * @returns {Object}
 */
function makeDnrBlockRule(id, domain, priority) {
  let action = {};

  if (!priority) {
    priority = constants.DNR_BLOCK;
  }

  action = {
    type: 'block'
  };

  let condition = {
    requestDomains: [domain],
    // TODO "A request is said to be first party if it has the same domain (eTLD+1) as the frame in which the request originated."
    // TODO will this ever be a problem? frame vs. top-level frame
    domainType: 'thirdParty',
  };
  let mdfpList = mdfp.getEntityList(getBaseDomain(domain));
  if (mdfpList.length) {
    condition.excludedInitiatorDomains = mdfpList;
  }

  let rule = { id, action, condition };
  if (priority != 1) { // TODO doublecheck there is no need to store 1
    rule.priority = priority;
  }

  return rule;
}

/**
 * Constructs a DNR rule object that cookieblocks a domain and its subdomains.
 *
 * @param {Integer} id
 * @param {String} domain
 * @param {Integer} [priority]
 *
 * @returns {Object}
 */
function makeDnrCookieblockRule(id, domain, priority) {
  let action = {};

  if (!priority) {
    priority = constants.DNR_COOKIEBLOCK_HEADERS;
  }

  action = {
    type: 'modifyHeaders',
    requestHeaders: [{ header: "cookie", operation: "remove" }],
    responseHeaders: [{ header: "set-cookie", operation: "remove" }]
  };

  let condition = {
    requestDomains: [domain],
    domainType: 'thirdParty',
  };
  let mdfpList = mdfp.getEntityList(getBaseDomain(domain));
  if (mdfpList.length) {
    condition.excludedInitiatorDomains = mdfpList;
  }

  let rule = { id, action, condition, priority };

  return rule;
}

/**
 * As part of cookieblocking, constructs a DNR rule object
 * that allows a domain and its subdomains.
 *
 * This is so that we can stack/layer (cookieblock over block) rules.
 *
 * @param {Integer} id
 * @param {String} domain
 * @param {Integer} [priority]
 *
 * @returns {Object}
 */
function makeDnrAllowRule(id, domain, priority) {
  priority = priority || constants.DNR_COOKIEBLOCK_ALLOW;

  let action = {
    type: 'allow'
  };

  let condition = {
    requestDomains: [domain],
    domainType: 'thirdParty'
  };

  let rule = { id, priority, action, condition };

  return rule;
}

/**
 * Constructs a DNR rule object for replacing scripts with our surrogates.
 *
 * @param {Integer} id
 * @param {String} script_host
 * @param {String} path
 * @param {Object} extra_conditions
 *
 * @returns {Object}
 */
function makeDnrSurrogateRule(id, script_host, path, extra_conditions) {
  let rule = {
    id,
    priority: constants.DNR_SURROGATE_REDIRECT,
    action: {
      type: 'redirect',
      redirect: {
        extensionPath: '/' + path.slice(chrome.runtime.getURL('').length)
      }
    },
    condition: {
      requestDomains: [script_host],
      resourceTypes: ['script'],
      domainType: 'thirdParty',
      excludedInitiatorDomains: mdfp.getEntityList(getBaseDomain(script_host))
    }
  };

  if (extra_conditions) {
    for (let key in extra_conditions) {
      rule.condition[key] = extra_conditions[key];
    }
  }

  if (!rule.condition.excludedInitiatorDomains.length) {
    delete rule.condition.excludedInitiatorDomains;
  }

  return rule;
}

/**
 * A single hostname may have multiple associated surrogates.
 * This function generates all associated DNR rule objects.
 *
 * TODO add unit tests for generated rules, like verify regexFilter matches what we want it to match?
 * TODO regex escape?
 *
 * @param {Function} idFunc function to call to get rule IDs
 * @param {String} script_host
 *
 * @returns {Array} DNR rule objects for this domain
 */
function getDnrSurrogateRules(idFunc, domain) {
  let rules = [];

  let conf = sdb.hostnames[domain];

  if (conf.match == sdb.MATCH_ANY) {
    rules.push(makeDnrSurrogateRule(idFunc(), domain, sdb.surrogates[conf.token]));

  } else if (conf.match == sdb.MATCH_SUFFIX) {
    for (let token of conf.tokens) {
      let extra = {
        // URL either ends with token, or with token followed by ?
        // followed by any number of characters
        // (?:) is an RE2 non-capturing group
        // TODO fix for 15f68c5cfb2034a6ef5a9b72302a5ecf3d195032
        // TODO don't need the leading .* right?
        regexFilter: `.*${token}(?:\\?.*)?$`
      };
      rules.push(makeDnrSurrogateRule(idFunc(), domain, sdb.surrogates[token], extra));
    }

  } else if (conf.match == sdb.MATCH_PREFIX) {
    for (let token of conf.tokens) {
      let extra = {
        regexFilter: `//${domain}${token}`.replace(/\//g, '\\/')
      };
      rules.push(makeDnrSurrogateRule(idFunc(), domain, sdb.surrogates[token], extra));
    }

  } else if (conf.match == sdb.MATCH_PREFIX_WITH_PARAMS) {
    for (let token of conf.tokens) {
      // TODO conf.params
      let extra = {
        regexFilter: `//${domain}${token}/?`.replace(/\//g, '\\/')
      };
      rules.push(makeDnrSurrogateRule(idFunc(), domain, sdb.surrogates[token], extra));
    }
  }

  return rules;
}

/**
 * Debounced version of chrome.declarativeNetRequest.updateDynamicRules()
 */
let updateDynamicRules = (function () {
  let queue = [];

  let _update = utils.debounce(function () {
    let opts = {
      addRules: [],
      removeRuleIds: []
    };

    for (let item of queue) {
      if (utils.hasOwn(item, "addRules")) {
        opts.addRules = opts.addRules.concat(item.addRules);
      }
      if (utils.hasOwn(item, "removeRuleIds")) {
        opts.removeRuleIds = opts.removeRuleIds.concat(item.removeRuleIds);
      }
    }
    queue = [];

    chrome.declarativeNetRequest.updateDynamicRules(opts);
  }, 100);

  return function (opts) {
    queue.push(opts);
    _update();
  };
}());

/**
 * Debounced version of chrome.declarativeNetRequest.updateEnabledRulesets()
 */
let updateEnabledRulesets = (function () {
  let queue = [];

  let _update = utils.debounce(function () {
    let opts = {
      enableRulesetIds: [],
      disableRulesetIds: []
    };

    for (let item of queue) {
      if (utils.hasOwn(item, "enableRulesetIds")) {
        opts.enableRulesetIds = opts.enableRulesetIds.concat(item.enableRulesetIds);
      }
      if (utils.hasOwn(item, "disableRulesetIds")) {
        opts.disableRulesetIds = opts.disableRulesetIds.concat(item.disableRulesetIds);
      }
    }
    queue = [];

    chrome.declarativeNetRequest.updateEnabledRulesets(opts);
  }, 100);

  return function (opts) {
    queue.push(opts);
    _update();
  };
}());

/**
 * Updates registered "allow all" DNR rules for the given
 * list of Privacy Badger disabled site entries.
 *
 * @param {Array} disabledSites disabled site entries (may contain wildcards)
 */
async function updateDisabledSitesRules(disabledSites) {
  let opts = {
    addRules: []
  };

  let rules = (await chrome.declarativeNetRequest.getDynamicRules())
    .filter(r => r.action.type == "allowAllRequests" &&
      r.priority == constants.DNR_SITE_ALLOW_ALL);

  opts.removeRuleIds = rules.map(r => r.id) || [];

  // remove leading wildcards
  // domains now always match subdomains
  disabledSites = disabledSites.map(site => {
    if (site.startsWith('*')) {
      site = site.slice(1);
      if (site.startsWith('.')) {
        site = site.slice(1);
      }
    }
    return site;
  });

  if (disabledSites.length) {
    opts.addRules.push({
      id: badger.getDynamicRuleId(),
      priority: constants.DNR_SITE_ALLOW_ALL,
      action: { type: 'allowAllRequests' },
      condition: {
        requestDomains: disabledSites,
        resourceTypes: ['main_frame']
      }
    });
  }

  if (opts.addRules.length || opts.removeRuleIds.length) {
    updateDynamicRules(opts);
  }
}

/**
 * Re-registers widget site allowlist[1] DNR rules.
 *
 * [1] Options > Widget Replacement > Site Exceptions
 *
 * @param {Object} widgetSiteAllowlist
 */
async function updateWidgetSiteAllowlistRules(widgetSiteAllowlist) {
  let opts = {
    addRules: []
  };

  let existingRules = await chrome.declarativeNetRequest.getDynamicRules();

  // remove all existing widget site allow rules
  opts.removeRuleIds = existingRules.filter(r => {
    return (r.priority == constants.DNR_WIDGET_ALLOW_ALL);
  }).map(r => r.id);

  for (let site_host in widgetSiteAllowlist) {
    let widgetDomains = widgetSiteAllowlist[site_host].map(widget_name => {
      let widget = badger.widgetList.find(w => w.name == widget_name);
      if (widget && widget.replacementButton && widget.replacementButton.unblockDomains) {
        return widget.replacementButton.unblockDomains;
      }
      return [];
    }).flat();

    for (let domain of widgetDomains) {
      // allow all requests inside frames served by this domain
      let rule = {
        id: badger.getDynamicRuleId(),
        priority: constants.DNR_WIDGET_ALLOW_ALL,
        action: { type: 'allowAllRequests' },
        condition: {
          initiatorDomains: [site_host],
          requestDomains: [domain],
          resourceTypes: ['sub_frame']
        }
      };
      if (domain.startsWith("*.")) {
        // support wildcard unblockDomains
        delete rule.condition.requestDomains;
        rule.condition.urlFilter = "||" + domain.slice(2);
      }
      opts.addRules.push(rule);

      // allow requests to this domain
      rule = {
        id: badger.getDynamicRuleId(),
        priority: constants.DNR_WIDGET_ALLOW_ALL,
        action: { type: 'allow' },
        condition: {
          initiatorDomains: [site_host],
          requestDomains: [domain]
        }
      };
      if (domain.startsWith("*.")) {
        // support wildcard unblockDomains
        delete rule.condition.requestDomains;
        rule.condition.urlFilter = "||" + domain.slice(2);
      }
      opts.addRules.push(rule);
    }
  }

  if (opts.addRules.length || opts.removeRuleIds.length) {
    updateDynamicRules(opts);
  }
}

export default {
  getDnrSurrogateRules,
  makeDnrAllowRule,
  makeDnrBlockRule,
  makeDnrCookieblockRule,
  updateDisabledSitesRules,
  updateDynamicRules,
  updateEnabledRulesets,
  updateWidgetSiteAllowlistRules,
};