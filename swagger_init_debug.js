
window.onload = function() {
  // Build a system
  var url = window.location.search.match(/url=([^&]+)/);
  if (url && url.length > 1) {
    url = decodeURIComponent(url[1]);
  } else {
    url = window.location.origin;
  }

  const swaggerSpec = require('./swagger/specs/main');

  var swaggerOptions = {
    spec: swaggerSpec,
    url: url,
    urls: options.swaggerUrls,
    dom_id: '#swagger-ui',
    deepLinking: true,
    presets: [
      SwaggerUIBundle.presets.apis,
      SwaggerUIStandalonePreset
    ],
    plugins: [
      SwaggerUIBundle.plugins.DownloadUrl
    ],
    layout: "StandaloneLayout"
  };

  // Add custom options
  if (options.customOptions) {
    Object.assign(swaggerOptions, options.customOptions);
  }

  // Initialize Swagger UI
  var ui = SwaggerUIBundle(swaggerOptions);

  // Handle OAuth if configured
  if (options.customOptions && options.customOptions.oauth) {
    ui.initOAuth(options.customOptions.oauth);
  }

  // Handle API key preauthorization
  if (options.customOptions && options.customOptions.preauthorizeApiKey) {
    const key = options.customOptions.preauthorizeApiKey.authDefinitionKey;
    const value = options.customOptions.preauthorizeApiKey.apiKeyValue;
    if (key && value) {
      const pid = setInterval(() => {
        const authorized = ui.preauthorizeApiKey(key, value);
        if (authorized) clearInterval(pid);
      }, 500);
    }
  }

  // Handle auth action
  if (options.customOptions && options.customOptions.authAction) {
    ui.authActions.authorize(options.customOptions.authAction);
  }

  window.ui = ui;
};
