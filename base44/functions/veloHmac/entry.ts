export function veloHmac({ jwt, apiKey, apiSecret }) {
    const payload = `${jwt}${apiKey}`;
    const encoder = new TextEncoder();
    const keyData = encoder.encode(apiSecret);
    const messageData = encoder.encode(payload);
    
    return crypto.subtle.importKey(
        'raw',
        keyData,
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    ).then(key => 
        crypto.subtle.sign('HMAC', key, messageData)
    ).then(signature => 
        Array.from(new Uint8Array(signature))
            .map(b => b.toString(16).padStart(2, '0'))
            .join('')
    );
}