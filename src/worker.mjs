



export default {
	async fetch(request, env, ctx) {
		const { method } = request;

		// Set the CORS headers for the preflight request
		if (method === 'OPTIONS') {
			return handleOptionsRequest();
		}

		// Handle GET request
		else if (request.method === 'GET') {
			return handleGetRequests(request, env);
		} 

		// Handle other request methods
		else {
			return new Response('Method Not Allowed', { status: 405 });
		}
	},
};

function handleOptionsRequest() {
	return new Response(null, {
	  headers: {
		'Access-Control-Allow-Origin': '*',
		'Access-Control-Allow-Methods': 'GET, OPTIONS',
		'Access-Control-Allow-Headers': 'Content-Type',
	  },
	});
}

async function handleGetRequests(request, env) {
	// authenticate
	const authErrorResponse = await authenticateRequest(request, env);
    if (authErrorResponse) {
        return authErrorResponse;
    }

	const fxCache = await env.MOOLAX_CACHE_KV.get('fxCache');
    const lastCacheDate = await env.MOOLAX_CACHE_KV.get('lastCacheDate');
    const ONE_DAY = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
	const now = Date.now();
	const isCacheValid = (now - lastCacheDate) < ONE_DAY;
	let headers = new Headers();
		headers.append('Access-Control-Allow-Origin', '*');
		headers.append('Content-Type', 'application/json');

    if (fxCache && lastCacheDate && isCacheValid) {
		console.log('returning cached data');
        return new Response(fxCache, { headers: headers });
    }

	console.log('contacting fixer.io');
	const fixerUrl = `http://data.fixer.io/api/latest?access_key=${env.FIXER_ACCESS_KEY}`;
    const response = await fetch(fixerUrl);

	if (!response.ok) {
		return new Response(`Third-party server failed with status ${response.status}`, { status: 500 });
	}

	const data = await response.json();
  	const success = data.success;
    if (!success) {
		return new Response(`Error: ${JSON.stringify(data.error)}`, { status: 500 });
	}
	
	const jsonString = JSON.stringify(data);
    await env.MOOLAX_CACHE_KV.put('fxCache', jsonString);
	await env.MOOLAX_CACHE_KV.put('lastCacheDate', now.toString());
	return new Response(jsonString, { headers: headers });
}

async function authenticateRequest(request, env) {
    const auth = request.headers.get('Authorization');
  	if (!auth || !auth.startsWith('Bearer ')) {
    	return new Response('Unauthorized', { status: 401 });
  	}
  	const token = auth.slice(7);
  	if (token !== env.CLIENT_API_KEY) {
    	return new Response('Invalid API key', { status: 403 });
  	}
	const url = new URL(request.url);
	if (url.pathname !== '/api') {
		return new Response('Not Found', { status: 404 });
	}
    return null;
}