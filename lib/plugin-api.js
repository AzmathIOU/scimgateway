// =================================================================================
// File:    plugin-api.js
//
// Author:  Jarle Elshaug
//
// Purpose: Demonstrate scimgateway api functionality by using a REST based plugin
//          Using /api ScimGateway transfer "as is" to plugin and returns plugin result by adding
//          {"meta": {"result": "success"}}
//          or
//          {"meta": {"result": "error"}}
//
//          This plugin becomes what you it to be
//
// Test prereq: Internet connection towards baseUrl defined for testing purpose (http://fakerestapi.azurewebsites.net)
//
// Supported by scimgateway:
//  GET /api
//  GET /api?queries
//  GET /api/{id}
//  POST /api + body
//  PUT /api/{id} + body
//  PATCH /api/{id} + body
//  DELETE /api/{id}
//
// =================================================================================

'use strict'

const http = require('http')
const https = require('https')
const HttpsProxyAgent = require('https-proxy-agent')
const URL = require('url').URL
const querystring = require('querystring')

// mandatory plugin initialization - start
let ScimGateway = null
try {
  ScimGateway = require('scimgateway')
} catch (err) {
  ScimGateway = require('./scimgateway')
}
const scimgateway = new ScimGateway()
const pluginName = scimgateway.pluginName
// const configDir = scimgateway.configDir
const configFile = scimgateway.configFile
let config = require(configFile).endpoint
config = scimgateway.processExtConfig(pluginName, config) // add any external config process.env and process.file
scimgateway.authPassThroughAllowed = false // true enables auth passThrough (no scimgateway authentication). scimgateway instead includes ctx (ctx.request.header) in plugin methods. Note, requires plugin-logic for handling/passing ctx.request.header.authorization to be used in endpoint communication
// mandatory plugin initialization - end

const _serviceClient = {}
const lock = new scimgateway.Lock()

// =================================================
// postApi
// =================================================
//
// example:
// post http://localhost:8890/api
// body = {"eventName":"AssignAccessRoleEvent","subjectName":"RACF_System-B","userID":"peter01"}
//
scimgateway.postApi = async (baseEntity, apiObj, ctx) => {
  const action = 'postApi'
  scimgateway.logger.debug(`${pluginName} handling "${action}" apiObj=${JSON.stringify(apiObj)}`)

  if (!apiObj.eventName || !apiObj.subjectName || !apiObj.userID) {
    const err = new Error('Unsupported POST content')
    throw err
  }

  const method = 'POST'
  const path = '/api/v1/Books'
  const body = {
    ID: 1,
    Title: apiObj.eventName,
    Description: apiObj.subjectName,
    Excerpt: apiObj.userID
  }
  try {
    const response = await doRequest(baseEntity, method, path, body, ctx)
    return response.body
  } catch (err) {
    const newErr = err
    throw newErr
  }
}

// =================================================
// putApi
// =================================================
//
// example:
// put http://localhost:8890/api/1
// body = {"eventName":"AssignAccessRoleEvent","subjectName":"RACF_System-B","userID":"peter01"}
//
scimgateway.putApi = async (baseEntity, id, apiObj, ctx) => {
  const action = 'putApi'
  scimgateway.logger.debug(`${pluginName}[${baseEntity}] handling "${action}" id=${id} apiObj=${JSON.stringify(apiObj)}`)

  if (!apiObj.eventName || !apiObj.subjectName || !apiObj.userID) {
    const err = new Error('Unsupported PUT content')
    throw err
  }

  const method = 'PUT'
  const path = `/api/v1/Books/${id}`
  const body = {
    ID: id,
    Title: apiObj.eventName,
    Description: apiObj.subjectName,
    Excerpt: apiObj.userID
  }
  try {
    const response = await doRequest(baseEntity, method, path, body, ctx)
    return response.body
  } catch (err) {
    const newErr = err
    throw newErr
  }
}

// =================================================
// patchApi
// =================================================
//
// example:
// patch http://localhost:8890/api/1
// body = {"eventName":"AssignAccessRoleEvent","subjectName":"RACF_System-B","userID":"peter01"}
//
scimgateway.patchApi = async (baseEntity, id, apiObj, ctx) => {
  const action = 'patchApi'
  scimgateway.logger.debug(`${pluginName}[${baseEntity}] handling "${action}" id=${id} apiObj=${JSON.stringify(apiObj)}`)

  if (!apiObj.eventName && !apiObj.subjectName && !apiObj.userID) {
    const err = new Error('Unsupported PATCH content')
    throw err
  }

  const method = 'PATCH'
  const path = `/api/v1/Books/${id}`
  const body = { ID: id }
  if (apiObj.eventName) body.Title = apiObj.eventName
  if (apiObj.subjectName) body.Description = apiObj.subjectName
  if (apiObj.userID) body.Excerpt = apiObj.userID

  try { // note, Books example do not support patch
    const response = await doRequest(baseEntity, method, path, body, ctx)
    return response.body
  } catch (err) {
    const newErr = err
    throw newErr
  }
}

// =================================================
// getApi
// =================================================
//
// examples:
// get http://localhost:8890/api
// get http://localhost:8890/api/1
// get http://localhost:8890/api?queries
//
scimgateway.getApi = async (baseEntity, id, apiQuery, apiObj, ctx) => {
  const action = 'getApi'
  scimgateway.logger.debug(`${pluginName}[${baseEntity}] handling "${action}" id=${id} apiQuery=${JSON.stringify(apiQuery)} apiObj=${JSON.stringify(apiObj)}`)

  try {
    const method = 'GET'
    if (id) {
      const path = `/api/v1/Books/${id}`
      const body = null
      const response = await doRequest(baseEntity, method, path, body, ctx)
      return response.body
    } else {
      const path = '/api/Books'
      const body = null
      if (apiQuery) { /* some logic here */ }
      const response = await doRequest(baseEntity, method, path, body, ctx)
      return response.body
    }
  } catch (err) {
    const newErr = err
    throw newErr
  }
}

// =================================================
// deleteApi
// =================================================
//
// example:
// delete http://localhost:8890/api/1
//
scimgateway.deleteApi = async (baseEntity, id, ctx) => {
  const action = 'deleteApi'
  scimgateway.logger.debug(`${pluginName}[${baseEntity}] handling "${action}" id=${id}`)

  const method = 'DELETE'
  const path = `/api/v1/Books/${id}`
  const body = null

  try {
    const response = await doRequest(baseEntity, method, path, body, ctx)
    return response.body
  } catch (err) {
    const newErr = err
    throw newErr
  }
}

// =================================================
// helpers
// =================================================

//
// start - REST endpoint template
//

const getClientIdentifier = (ctx) => {
  if (!ctx?.request?.header?.authorization) return undefined
  const [user, secret] = getCtxAuth(ctx)
  return `${encodeURIComponent(user)}_${encodeURIComponent(secret)}` // user_password or undefined_password
}

//
// getCtxAuth returns username/secret from ctx header when using Auth PassThrough
//
const getCtxAuth = (ctx) => {
  if (!ctx?.request?.header?.authorization) return []
  const [authType, authToken] = (ctx.request.header.authorization || '').split(' ') // [0] = 'Basic' or 'Bearer'
  let username, password
  if (authType === 'Basic') [username, password] = (Buffer.from(authToken, 'base64').toString() || '').split(':')
  if (username) return [username, password] // basic auth
  else return [undefined, authToken] // bearer auth
}

//
// getAccessToken - returns oauth accesstoken
//
const getAccessToken = async (baseEntity, ctx) => {
  await lock.acquire()
  const clientIdentifier = getClientIdentifier(ctx)
  const d = new Date() / 1000 // seconds (unix time)
  if (_serviceClient[baseEntity] && _serviceClient[baseEntity][clientIdentifier] && _serviceClient[baseEntity][clientIdentifier].accessToken &&
   (_serviceClient[baseEntity][clientIdentifier].accessToken.validTo >= d + 30)) { // avoid simultaneously token requests
    lock.release()
    return _serviceClient[baseEntity][clientIdentifier].accessToken
  }

  const action = 'getAccessToken'
  scimgateway.logger.debug(`${pluginName}[${baseEntity}] ${action}: Retrieving accesstoken`)

  const method = 'POST'
  const [, secret] = getCtxAuth(ctx) // if Auth PassTrough, secret from basic or bearer auth
  let tokenUrl
  let form

  if (config.entity[baseEntity].oauth) {
    let resource
    try {
      const urlObj = new URL(config.entity[baseEntity].baseUrls[0])
      resource = urlObj.origin
    } catch (err) {
      resource = null
    }
    if (config.entity[baseEntity].oauth.tenantIdGUID) { // Azure
      tokenUrl = `https://login.microsoftonline.com/${config.entity[baseEntity].oauth.tenantIdGUID}/oauth2/token`
    } else {
      tokenUrl = `https://login.microsoftonline.com/${config.entity[baseEntity].oauth.tokenUrl}`
    }
    form = {
      grant_type: 'client_credentials',
      client_id: config.entity[baseEntity].oauth.clientId,
      client_secret: secret || scimgateway.getPassword(`endpoint.entity.${baseEntity}.oauth.clientSecret`, configFile), // using config if no Auth PassThrough
      resource: resource // "https://graph.microsoft.com"
    }
  } else {
    const err = new Error(`[${action}] missing supported endpoint authentication configuration`)
    lock.release()
    throw (err)
  }

  const options = {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded' // body must be query string formatted (no JSON)
    }
  }

  try {
    const response = await doRequest(baseEntity, method, tokenUrl, form, ctx, options)
    if (!response.body) {
      const err = new Error(`[${action}] No data retrieved from: ${method} ${tokenUrl}`)
      throw (err)
    }
    const jbody = response.body
    if (jbody.error) {
      const err = new Error(`[${action}] Error message: ${jbody.error_description}`)
      throw (err)
    } else if (!jbody.access_token || !jbody.expires_in) {
      const err = new Error(`[${action}] Error message: Retrieved invalid token response`)
      throw (err)
    }

    const d = new Date() / 1000 // seconds (unix time)
    jbody.validTo = d + parseInt(jbody.expires_in) // instead of using expires_on (clock may not be in sync with NTP, AAD default expires_in = 3600 seconds)
    scimgateway.logger.silly(`${pluginName}[${baseEntity}] ${action}: AccessToken =  ${jbody.access_token}`)

    lock.release()
    return jbody
  } catch (err) {
    lock.release()
    throw (err)
  }
}

//
// getServiceClient - returns options needed for connection parameters
//
//   path = e.g. "/xxx/yyy", then using host/port/protocol based on config baseUrls[0]
//          auth automatically added and failover according to baseUrls array
//
//   path = url e.g. "http(s)://<host>:<port>/xxx/yyy", then using the url host/port/protocol
//          opt (options) may be needed e.g {auth: {username: "username", password: "password"} }
//
const getServiceClient = async (baseEntity, method, path, opt, ctx) => {
  const action = 'getServiceClient'

  let authType
  if (config.entity[baseEntity].basicAuth) authType = 'basicAuth'
  else if (config.entity[baseEntity].oauth) authType = 'oauth'
  else if (config.entity[baseEntity].bearerAuth) authType = 'bearerAuth'

  let urlObj
  if (!path) path = ''
  try {
    urlObj = new URL(path)
  } catch (err) {
    //
    // path (no url) - default approach and client will be cached based on config
    //

    const clientIdentifier = getClientIdentifier(ctx)
    if (_serviceClient[baseEntity] && _serviceClient[baseEntity][clientIdentifier]) { // serviceClient already exist - Azure plugin specific
      scimgateway.logger.debug(`${pluginName}[${baseEntity}] ${action}: Using existing client`)
      if (_serviceClient[baseEntity][clientIdentifier].accessToken) {
      // check if token refresh is needed when using oauth
        const d = new Date() / 1000 // seconds (unix time)
        if (_serviceClient[baseEntity][clientIdentifier].accessToken.validTo < d + 30) { // less than 30 sec before token expiration
          scimgateway.logger.debug(`${pluginName}[${baseEntity}] ${action}: Accesstoken about to expire in ${_serviceClient[baseEntity][clientIdentifier].accessToken.validTo - d} seconds`)
          try {
            const accessToken = await getAccessToken(baseEntity, ctx)
            _serviceClient[baseEntity][clientIdentifier].accessToken = accessToken
            _serviceClient[baseEntity][clientIdentifier].options.headers.Authorization = ` Bearer ${accessToken.access_token}`
          } catch (err) {
            delete _serviceClient[baseEntity][clientIdentifier]
            const newErr = err
            throw newErr
          }
        }
      }
    } else {
      scimgateway.logger.debug(`${pluginName}[${baseEntity}] ${action}: Client have to be created`)
      let client = null
      if (config.entity && config.entity[baseEntity]) client = config.entity[baseEntity]
      if (!client) {
        const err = new Error(`Base URL have baseEntity=${baseEntity}, and configuration file ${pluginName}.json is missing required baseEntity configuration for ${baseEntity}`)
        throw err
      }
      if (!config.entity[baseEntity].baseUrls || !Array.isArray(config.entity[baseEntity].baseUrls) || config.entity[baseEntity].baseUrls.length < 1) {
        const err = new Error(`missing configuration entity.${baseEntity}.baseUrls`)
        throw err
      }
      urlObj = new URL(config.entity[baseEntity].baseUrls[0])
      const param = {
        baseUrl: config.entity[baseEntity].baseUrls[0],
        options: {
          json: true, // json-object response instead of string
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json'
          },
          host: urlObj.hostname,
          port: urlObj.port, // null if https and 443 defined in url
          protocol: urlObj.protocol // http: or https:
          // 'method' and 'path' added at the end
        }
      }

      if (ctx?.request?.header?.authorization) { // Auth PassThrough using ctx header
        param.options.headers.Authorization = ctx.request.header.authorization
      } else {
        switch (authType) {
          case 'basicAuth':
            if (!config.entity[baseEntity].basicAuth.username || !config.entity[baseEntity].basicAuth.password) {
              const err = new Error(`missing configuration entity.${baseEntity}.basicAuth.username/password`)
              throw err
            }
            param.options.headers.Authorization = 'Basic ' + Buffer.from(`${config.entity[baseEntity].basicAuth.username}:${scimgateway.getPassword(`endpoint.entity.${baseEntity}.basicAuth.password`, configFile)}`).toString('base64')
            break
          case 'oauth':
            if (!config.entity[baseEntity].oauth.clientId || !config.entity[baseEntity].oauth.clientSecret) {
              const err = new Error(`missing configuration entity.${baseEntity}.oauth.clientId/clientSecret`)
              throw err
            }
            param.accessToken = await getAccessToken(baseEntity, ctx)
            param.options.headers.Authorization = `Bearer ${param.accessToken.access_token}`
            break
          case 'bearerAuth':
            if (!config.entity[baseEntity].bearerAuth.token) {
              const err = new Error(`missing configuration entity.${baseEntity}.bearerAuth.token`)
              throw err
            }
            param.options.headers.Authorization = 'Bearer ' + Buffer.from(`${scimgateway.getPassword(`endpoint.entity.${baseEntity}.bearerAuth.token`, configFile)}`).toString('base64')
            break
          default:
            // no auth
        }
      }

      // proxy
      if (config.entity[baseEntity].proxy && config.entity[baseEntity].proxy.host) {
        const agent = new HttpsProxyAgent(config.entity[baseEntity].proxy.host)
        param.options.agent = agent // proxy
        if (config.entity[baseEntity].proxy.username && config.entity[baseEntity].proxy.password) {
          param.options.headers['Proxy-Authorization'] = 'Basic ' + Buffer.from(`${config.entity[baseEntity].proxy.username}:${scimgateway.getPassword(`endpoint.entity.${baseEntity}.proxy.password`, configFile)}`).toString('base64') // using proxy with auth
        }
      }

      // config options
      if (config.entity[baseEntity].options) param.options = scimgateway.extendObj(param.options, config.entity[baseEntity].options)

      if (!_serviceClient[baseEntity]) _serviceClient[baseEntity] = {}
      if (!_serviceClient[baseEntity][clientIdentifier]) _serviceClient[baseEntity][clientIdentifier] = {}
      _serviceClient[baseEntity][clientIdentifier] = param // serviceClient created

      // OData support - note, not using [clientIdentifier]
      _serviceClient[baseEntity].nextLink = {}
      _serviceClient[baseEntity].nextLink.users = null // Azure users pagination
      _serviceClient[baseEntity].nextLink.groups = null // Azure groups pagination
    }

    const cli = scimgateway.copyObj(_serviceClient[baseEntity][clientIdentifier]) // client ready

    // failover support
    path = _serviceClient[baseEntity][clientIdentifier].baseUrl + path
    urlObj = new URL(path)
    cli.options.host = urlObj.hostname
    cli.options.port = urlObj.port
    cli.options.protocol = urlObj.protocol

    // adding none static
    cli.options.method = method
    cli.options.path = `${urlObj.pathname}${urlObj.search}`
    if (opt) cli.options = scimgateway.extendObj(cli.options, opt) // merge with argument options

    return cli // final client
  }
  //
  // url path - none config based and used as is (no cache)
  //
  scimgateway.logger.debug(`${pluginName}[${baseEntity}] ${action}: Using none config based client`)
  let options = {
    json: true,
    headers: {
      'Content-Type': 'application/json'
    },
    host: urlObj.hostname,
    port: urlObj.port,
    protocol: urlObj.protocol,
    method: method,
    path: urlObj.pathname
  }

  // proxy
  if (config.entity[baseEntity].proxy && config.entity[baseEntity].proxy.host) {
    const agent = new HttpsProxyAgent(config.entity[baseEntity].proxy.host)
    options.agent = agent // proxy
    if (config.entity[baseEntity].proxy.username && config.entity[baseEntity].proxy.password) {
      options.headers['Proxy-Authorization'] = 'Basic ' + Buffer.from(`${config.entity[baseEntity].proxy.username}:${scimgateway.getPassword(`endpoint.entity.${baseEntity}.proxy.password`, configFile)}`).toString('base64') // using proxy with auth
    }
  }

  // merge any argument options - support basic auth using {auth: {username: "username", password: "password"} }
  if (opt) {
    const o = scimgateway.copyObj(opt)
    if (o.auth) {
      options.headers.Authorization = 'Basic ' + Buffer.from(`${o.auth.username}:${o.auth.password}`).toString('base64')
      delete o.auth
    }
    options = scimgateway.extendObj(options, o)
  }

  const cli = {}
  cli.options = options
  return cli // final client
}

const updateServiceClient = (baseEntity, clientIdentifier, obj) => {
  if (_serviceClient[baseEntity] && _serviceClient[baseEntity][clientIdentifier]) _serviceClient[baseEntity][clientIdentifier] = scimgateway.extendObj(_serviceClient[baseEntity][clientIdentifier], obj) // merge with argument options
}

//
// doRequest - execute REST service
//
const doRequest = async (baseEntity, method, path, body, ctx, opt, retryCount) => {
  let retryAfter = 0
  try {
    const cli = await getServiceClient(baseEntity, method, path, opt, ctx)
    const options = cli.options

    const result = await new Promise((resolve, reject) => {
      let dataString = ''
      if (body) {
        if (options.headers['Content-Type'].toLowerCase() === 'application/x-www-form-urlencoded') {
          if (typeof data === 'string') dataString = body
          else dataString = querystring.stringify(body) // JSON to query string syntax + URL encoded
        } else dataString = JSON.stringify(body)
        options.headers['Content-Length'] = Buffer.byteLength(dataString, 'utf8')
      }

      const reqType = (options.protocol.toLowerCase() === 'https:') ? https.request : http.request
      const req = reqType(options, (res) => {
        const { statusCode, statusMessage } = res // solving parallel problem (const + don't use res.statusCode)

        let responseString = ''
        res.setEncoding('utf-8')

        res.on('data', (chunk) => {
          responseString += chunk
        })

        res.on('end', () => {
          const response = {
            statusCode: statusCode,
            statusMessage: statusMessage,
            body: null
          }
          try {
            if (responseString) response.body = JSON.parse(responseString)
          } catch (err) { response.body = responseString }
          if (statusCode < 200 || statusCode > 299) {
            if (statusCode === 429) { // throttle
              const v = res.headers['retry-after']
              if (!isNaN(v)) retryAfter = parseInt(v, 10) + 1
              else retryAfter = 10
            }
            reject(new Error(JSON.stringify(response)))
          }
          resolve(response)
        })
      }) // req

      req.on('socket', (socket) => {
        socket.setTimeout(60000) // connect and wait timeout => socket hang up
        socket.on('timeout', function () { req.abort() })
      })

      req.on('error', (error) => { // also catching req.abort
        req.end()
        reject(error)
      })

      if (dataString) req.write(dataString)
      req.end()
    }) // Promise

    scimgateway.logger.debug(`${pluginName}[${baseEntity}] doRequest ${method} ${options.protocol}//${options.host}${(options.port ? `:${options.port}` : '')}${options.path} Body = ${JSON.stringify(body)} Response = ${JSON.stringify(result)}`)
    return result
  } catch (err) { // includes failover/retry logic based on config baseUrls array
    let statusCode
    try { statusCode = JSON.parse(err.message).statusCode } catch (e) {}
    if (statusCode === 404) { // not logged as error, let caller decide e.g. getUser-manager
      scimgateway.logger.debug(`${pluginName}[${baseEntity}] doRequest ${method} ${path} Body = ${JSON.stringify(body)} Error Response = ${err.message}`)
    } else scimgateway.logger.error(`${pluginName}[${baseEntity}] doRequest ${method} ${path} Body = ${JSON.stringify(body)} Error Response = ${err.message}`)
    const clientIdentifier = getClientIdentifier(ctx)
    if (err.message.includes('ratelimit')) { // have seen throttling not follow standard 429/retry-after, but instead using 500 and error message only
      if (!retryAfter) retryAfter = 60
    }
    if (!retryCount) retryCount = 0
    let urlObj
    try { urlObj = new URL(path) } catch (err) {}
    if (!urlObj && (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND' || err.code === 'ETIMEDOUT' || retryAfter)) {
      if (retryAfter) {
        scimgateway.logger.debug(`${pluginName}[${baseEntity}] doRequest ${method} ${path} throttle/ratelimit error - awaiting ${retryAfter} seconds before automatic retry`)
        await new Promise((resolve, reject) => setTimeout(function () {
          resolve()
        }, retryAfter * 1000))
      }
      if (retryCount < config.entity[baseEntity].baseUrls.length) {
        retryCount++
        updateServiceClient(baseEntity, clientIdentifier, { baseUrl: config.entity[baseEntity].baseUrls[retryCount - 1] })
        scimgateway.logger.debug(`${pluginName}[${baseEntity}] ${(config.entity[baseEntity].baseUrls.length > 1) ? 'failover ' : ''}retry[${retryCount}] using baseUrl = ${_serviceClient[baseEntity].baseUrl}`)
        const ret = await doRequest(baseEntity, method, path, body, ctx, opt, retryCount) // retry
        return ret // problem fixed
      } else {
        const newerr = new Error(err.message)
        newerr.message = newerr.message.replace('ECONNREFUSED', 'UnableConnectingService') // avoid returning ECONNREFUSED error
        newerr.message = newerr.message.replace('ENOTFOUND', 'UnableConnectingHost') // avoid returning ENOTFOUND error
        throw newerr
      }
    } else {
      if (statusCode === 401 && _serviceClient[baseEntity]) delete _serviceClient[baseEntity][clientIdentifier]
      throw err // CA IM retries getUser failure once (retry 6 times on ECONNREFUSED)
    }
  }
} // doRequest

//
// end - REST endpoint template
//

//
// Cleanup on exit
//
process.on('SIGTERM', () => { // kill
})
process.on('SIGINT', () => { // Ctrl+C
})
