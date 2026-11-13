// Signs a widget token for your signed-in user. Java 11 or later, standard library only.
//
//   UCP_WIDGET_SECRET=... UCP_ISSUER=https://portal.example.org UCP_WIDGET_ID=w_... java Sign.java <user id>
//
// Call Sign.widgetToken(userId) from the endpoint your page's getToken fetches, after checking the user is signed
// in. The user ID must be your stable ID for the user, never an email address or a name.

import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.Base64;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

public class Sign {
    private static final Base64.Encoder PART = Base64.getUrlEncoder().withoutPadding();

    public static String widgetToken(String userId) throws Exception {
        long now = System.currentTimeMillis() / 1000;
        String secretId = System.getenv("UCP_SECRET_ID"); // which secret signed it, while two are in use
        String header = secretId == null || secretId.isEmpty()
            ? "{\"alg\":\"HS256\",\"typ\":\"JWT\"}"
            : "{\"alg\":\"HS256\",\"typ\":\"JWT\",\"kid\":" + text(secretId) + "}";
        byte[] random = new byte[16];
        new SecureRandom().nextBytes(random);
        String claims = "{\"iss\":" + text(System.getenv("UCP_ISSUER"))
            + ",\"aud\":" + text(System.getenv("UCP_WIDGET_ID"))
            + ",\"sub\":" + text(userId)
            + ",\"iat\":" + now
            + ",\"exp\":" + (now + 300) // five minutes; the chat asks again when it needs a new one
            + ",\"jti\":" + text(PART.encodeToString(random)) // used once only
            + "}";
        String signed = encode(header) + "." + encode(claims);
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(System.getenv("UCP_WIDGET_SECRET").getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
        return signed + "." + PART.encodeToString(mac.doFinal(signed.getBytes(StandardCharsets.UTF_8)));
    }

    private static String encode(String json) {
        return PART.encodeToString(json.getBytes(StandardCharsets.UTF_8));
    }

    /** A JSON string, with the characters JSON needs escaped. */
    private static String text(String value) {
        StringBuilder out = new StringBuilder("\"");
        for (char c : value.toCharArray()) {
            if (c == '"' || c == '\\') out.append('\\').append(c);
            else if (c < 0x20) out.append(String.format("\\u%04x", (int) c));
            else out.append(c);
        }
        return out.append('"').toString();
    }

    public static void main(String[] args) throws Exception {
        System.out.println(widgetToken(args[0]));
    }
}
