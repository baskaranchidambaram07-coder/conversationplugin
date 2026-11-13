// Signs a widget token for your signed-in user. .NET 8 or later, no packages.
//
//   UCP_WIDGET_SECRET=... UCP_ISSUER=https://portal.example.org UCP_WIDGET_ID=w_... dotnet run -- <user id>
//
// Call WidgetTokens.Sign(userId) from the endpoint your page's getToken fetches, after checking the user is signed
// in. The user ID must be your stable ID for the user, never an email address or a name.

using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

Console.WriteLine(WidgetTokens.Sign(args[0]));

public static class WidgetTokens
{
    public static string Sign(string userId)
    {
        var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        var header = new Dictionary<string, object> { ["alg"] = "HS256", ["typ"] = "JWT" };
        var secretId = Environment.GetEnvironmentVariable("UCP_SECRET_ID");
        if (!string.IsNullOrEmpty(secretId)) header["kid"] = secretId; // which secret signed it, while two are in use
        var claims = new Dictionary<string, object>
        {
            ["iss"] = Environment.GetEnvironmentVariable("UCP_ISSUER")!,
            ["aud"] = Environment.GetEnvironmentVariable("UCP_WIDGET_ID")!,
            ["sub"] = userId,
            ["iat"] = now,
            ["exp"] = now + 300, // five minutes; the chat asks again when it needs a new one
            ["jti"] = Part(RandomNumberGenerator.GetBytes(16)), // used once only
        };
        var signed = Part(JsonSerializer.SerializeToUtf8Bytes(header)) + "." + Part(JsonSerializer.SerializeToUtf8Bytes(claims));
        var key = Encoding.UTF8.GetBytes(Environment.GetEnvironmentVariable("UCP_WIDGET_SECRET")!);
        return signed + "." + Part(HMACSHA256.HashData(key, Encoding.UTF8.GetBytes(signed)));
    }

    private static string Part(byte[] data) =>
        Convert.ToBase64String(data).TrimEnd('=').Replace('+', '-').Replace('/', '_');
}
