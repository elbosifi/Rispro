using RISpro.Scanner.Core.Config;
using RISpro.Scanner.Core.Scanning;
using Xunit;

namespace RISpro.Scanner.Tests;

public sealed class ScannerConfigStoreTests
{
    [Fact]
    public async Task MockScanner_creates_retryable_pdf()
    {
        var service = new MockScannerService();
        var result = await service.ScanToPdfAsync(new ScannerProfile("Mock Scanner", 200, "grayscale", "feeder"), Path.GetTempPath());

        Assert.True(File.Exists(result.PdfPath));
        Assert.Equal(1, result.PageCount);
        File.Delete(result.PdfPath);
    }
}
