using RISpro.Scanner.Core.Protocol;
using Xunit;

namespace RISpro.Scanner.Tests;

public sealed class ScannerProtocolTests
{
    [Fact]
    public void TryParseToken_accepts_scanner_protocol_token()
    {
        Assert.Equal("abc 123", ScannerProtocol.TryParseToken("rispro-scanner://scan?token=abc%20123"));
    }

    [Fact]
    public void TryParseToken_rejects_non_scan_urls()
    {
        Assert.Null(ScannerProtocol.TryParseToken("https://example.test/scan?token=abc"));
        Assert.Null(ScannerProtocol.TryParseToken("rispro-scanner://setup?token=abc"));
    }
}
