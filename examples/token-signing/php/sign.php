<?php
// Signs a widget token for your signed-in user. PHP 7.3 or later, no packages.
//
//   UCP_WIDGET_SECRET=... UCP_ISSUER=https://portal.example.org UCP_WIDGET_ID=w_... php sign.php <user id>
//
// Call widget_token($userId) from the endpoint your page's getToken fetches, after checking the user is signed in.
// The user ID must be your stable ID for the user, never an email address or a name.

function widget_token_part(string $data): string
{
    return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
}

function widget_token(string $userId): string
{
    $now = time();
    $header = ['alg' => 'HS256', 'typ' => 'JWT'];
    if (getenv('UCP_SECRET_ID')) {
        $header['kid'] = getenv('UCP_SECRET_ID'); // which secret signed it, while two are in use
    }
    $claims = [
        'iss' => getenv('UCP_ISSUER'),
        'aud' => getenv('UCP_WIDGET_ID'),
        'sub' => $userId,
        'iat' => $now,
        'exp' => $now + 300, // five minutes; the chat asks again when it needs a new one
        'jti' => widget_token_part(random_bytes(16)), // used once only
    ];
    $flags = JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR;
    $signed = widget_token_part(json_encode($header, $flags)) . '.' . widget_token_part(json_encode($claims, $flags));
    return $signed . '.' . widget_token_part(hash_hmac('sha256', $signed, getenv('UCP_WIDGET_SECRET'), true));
}

if (PHP_SAPI === 'cli' && isset($argv[1])) {
    echo widget_token($argv[1]), PHP_EOL;
}
