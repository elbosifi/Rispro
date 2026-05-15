namespace RISpro.Scanner.Core.Protocol;

public static class ScannerProtocol
{
    public static string? TryParseToken(string? argument)
    {
        if (string.IsNullOrWhiteSpace(argument)) return null;
        if (!Uri.TryCreate(argument, UriKind.Absolute, out var uri)) return null;
        if (!string.Equals(uri.Scheme, "rispro-scanner", StringComparison.OrdinalIgnoreCase)) return null;
        if (!string.Equals(uri.Host, "scan", StringComparison.OrdinalIgnoreCase)) return null;

        var token = uri.Query.TrimStart('?')
            .Split('&', StringSplitOptions.RemoveEmptyEntries)
            .Select(part => part.Split('=', 2))
            .Where(pair => pair.Length == 2 && string.Equals(Uri.UnescapeDataString(pair[0]), "token", StringComparison.OrdinalIgnoreCase))
            .Select(pair => Uri.UnescapeDataString(pair[1]))
            .FirstOrDefault();
        return string.IsNullOrWhiteSpace(token) ? null : token;
    }
}
