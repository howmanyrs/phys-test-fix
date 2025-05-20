(function() {
    // --- Find the SCORM API ---
    var API_WRAPPER = null; // Will hold the object that has LMSCommit, etc.

    function findAPI(win) {
        try {
            if (win && win.API && typeof win.API.LMSCommit === 'function') {
                console.log("Found SCORM 1.2 API on window.API");
                return win.API;
            }
            if (win && win.API_1484_11 && typeof win.API_1484_11.Commit === 'function') {
                console.log("Found SCORM 2004 API on window.API_1484_11");
                return win.API_1484_11;
            }
            if (win && typeof win.LMSCommit === 'function') {
                console.log("Found SCORM API functions directly on window object.");
                var directAPI = {};
                var funcs = ["LMSInitialize", "LMSFinish", "LMSGetValue", "LMSSetValue", "LMSCommit", "LMSGetLastError", "LMSGetErrorString", "LMSGetDiagnostic",
                             "Initialize", "Terminate", "GetValue", "SetValue", "Commit", "GetLastError", "GetErrorString", "GetDiagnostic"];
                var foundCoreCommit = false;
                funcs.forEach(function(funcName) {
                    if (typeof win[funcName] === 'function') {
                        directAPI[funcName] = win[funcName];
                        if (funcName === "LMSCommit" || funcName === "Commit") {
                            foundCoreCommit = true;
                        }
                    }
                });
                if (foundCoreCommit) return directAPI;
            }
        } catch (e) {
            // console.warn("Error trying to access API in a window (likely cross-origin):", e);
            return null;
        }

        if (win && win.parent && win.parent !== win) {
            console.log("Searching for API in parent window...");
            try {
                var parentAPI = findAPI(win.parent);
                if (parentAPI) return parentAPI;
            } catch (e) {
                // console.warn("Could not access parent window (cross-origin?):", e);
            }
        }
        if (win && win.opener) {
            console.log("Searching for API in opener window...");
            try {
                var openerAPI = findAPI(win.opener);
                if (openerAPI) return openerAPI;
            } catch (e) {
                // console.warn("Could not access opener window (cross-origin?):", e);
            }
        }
        return null;
    }

    function callScormApi(functionName, ...args) {
        if (!API_WRAPPER) {
            console.error("SCORM API Wrapper not found when trying to call:", functionName);
            return null;
        }
        var scorm12FunctionName = "LMS" + functionName.charAt(0).toUpperCase() + functionName.slice(1);
        var scorm2004FunctionName = functionName.charAt(0).toUpperCase() + functionName.slice(1);

        if (typeof API_WRAPPER[scorm12FunctionName] === 'function') {
            return API_WRAPPER[scorm12FunctionName](...args);
        } else if (typeof API_WRAPPER[scorm2004FunctionName] === 'function') {
            return API_WRAPPER[scorm2004FunctionName](...args);
        } else if (typeof API_WRAPPER[functionName] === 'function') {
             return API_WRAPPER[functionName](...args);
        } else {
            console.error(`SCORM API function ${scorm12FunctionName} or ${scorm2004FunctionName} or ${functionName} not found on API object.`);
            return null;
        }
    }

    if (typeof window.SCORM_log === 'undefined') {
        window.SCORM_log = function() { /* console.log("window.SCORM_log (stub):", ...arguments); */ };
    }
    if (typeof window.errorCode === 'undefined') {
        window.errorCode = '0';
    }

    var keepAliveIntervalMs = 10000; // Значение по умолчанию
    var keepAliveTimerId = null;
    var keepAliveCounter = 0;

    function performScormKeepAlive() {
        if (!API_WRAPPER) {
            console.warn('SCORM API not found for keep-alive. Stopping pings.');
            if (keepAliveTimerId) clearInterval(keepAliveTimerId);
            keepAliveTimerId = null;
            return;
        }

        keepAliveCounter++;
        console.log(`SCORM Keep-Alive attempt #${keepAliveCounter}`);
        try {
            window.errorCode = '0';
            var commitResult = callScormApi('commit', "");
            console.log('Commit("") result:', commitResult);

            if (commitResult === "true" || commitResult === true) {
                 var lastError = callScormApi('getLastError', "");
                 console.log('GetLastError() after commit:', lastError);
                 window.errorCode = lastError;
            } else {
                console.warn('Commit was not successful, attempting to get error details.');
                var lastErrorAfterFail = callScormApi('getLastError', "");
                console.log('LMSGetLastError() after failed commit:', lastErrorAfterFail);
                window.errorCode = lastErrorAfterFail;
            }
        } catch (e) {
            console.error('Error during SCORM Keep-Alive Commit:', e);
        }
    }

    window.startScormKeepAlive = function(intervalSeconds) {
        var isRestarting = false;
        var newIntervalManuallySet = false;

        if (intervalSeconds && !isNaN(parseInt(intervalSeconds)) && parseInt(intervalSeconds) > 0) {
            var newIntervalMs = parseInt(intervalSeconds) * 1000;
            if (newIntervalMs !== keepAliveIntervalMs) {
                keepAliveIntervalMs = newIntervalMs;
                console.log("Keep-alive interval updated to " + intervalSeconds + " seconds.");
                newIntervalManuallySet = true;
                if (keepAliveTimerId !== null) {
                    console.log("Stopping current keep-alive to apply new interval.");
                    clearInterval(keepAliveTimerId);
                    keepAliveTimerId = null; // Важно сбросить, чтобы запустить новый таймер
                    isRestarting = true;
                }
            } else {
                // Интервал передан, но он такой же, как текущий
                newIntervalManuallySet = true;
            }
        }

        if (keepAliveTimerId !== null && !isRestarting) {
            if (newIntervalManuallySet) { // Если был передан интервал, но он совпал с текущим, и таймер работает
                 console.log("SCORM keep-alive is already running with the specified interval (" + (keepAliveIntervalMs / 1000) + "s).");
            } else { // Если интервал не передавался (например, повторный вызов без аргументов)
                 console.log("SCORM keep-alive is already running.");
            }
            return;
        }

        if (!API_WRAPPER) {
            console.log("Attempting to find SCORM API for keep-alive...");
            API_WRAPPER = findAPI(window);
            if (!API_WRAPPER) {
                console.error("SCORM API (API_WRAPPER) not found. Cannot start keep-alive. Ensure SCORM is loaded and initialized.");
                return;
            }
            console.log("SCORM API found or confirmed for keep-alive.");
        }

        var commitFunc12 = API_WRAPPER.LMSCommit;
        var commitFunc2004 = API_WRAPPER.Commit;
        var scormCommitFunctionExists = (typeof commitFunc12 === 'function' || typeof commitFunc2004 === 'function');

        if (!scormCommitFunctionExists) {
             console.error("SCORM Commit function (LMSCommit or Commit) not found on the detected API_WRAPPER. Cannot start keep-alive.");
             API_WRAPPER = null; // Сбрасываем, чтобы при следующем вызове startScormKeepAlive() поиск был выполнен заново
             return;
        }

        if (isRestarting) {
            console.log(`Restarting SCORM keep-alive: Commit("") every ${keepAliveIntervalMs / 1000} seconds.`);
        } else {
            console.log(`Starting SCORM keep-alive: Commit("") every ${keepAliveIntervalMs / 1000} seconds.`);
        }
        
        keepAliveCounter = 0;
        performScormKeepAlive();
        keepAliveTimerId = setInterval(performScormKeepAlive, keepAliveIntervalMs);
        console.log("To stop, type: window.stopScormKeepAlive() and press Enter.");
    };

    window.stopScormKeepAlive = function() {
        if (keepAliveTimerId) {
            clearInterval(keepAliveTimerId);
            keepAliveTimerId = null;
            console.log("SCORM keep-alive pings stopped.");
        } else {
            console.log("SCORM keep-alive pings were not running.");
        }
    };

    // --- Инициализация и автозапуск ---
    console.log("SCORM Keep-Alive script initializing...");
    API_WRAPPER = findAPI(window); // Первоначальная попытка найти API

    if (API_WRAPPER) {
        console.log("SCORM API found on initial load.");
        // Для отладки можно раскомментировать: console.log("API Object:", API_WRAPPER);
    } else {
        console.log("SCORM API not found on initial load. Will try to find it again during auto-start.");
    }

    // --- АВТОМАТИЧЕСКИЙ ЗАПУСК ---
    // Запускаем keep-alive автоматически после загрузки скрипта с интервалом по умолчанию.
    // Пользователь может остановить его с помощью window.stopScormKeepAlive()
    // или перезапустить с другим интервалом: window.startScormKeepAlive(newIntervalInSeconds)
    console.log("Attempting to auto-start SCORM keep-alive with default interval (" + (keepAliveIntervalMs / 1000) + "s)...");
    window.startScormKeepAlive(); // Вызов без аргументов будет использовать интервал по умолчанию

})();
