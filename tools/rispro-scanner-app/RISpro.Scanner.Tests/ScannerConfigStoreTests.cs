using RISpro.Scanner.Core.Config;
using RISpro.Scanner.Core.Scanning;
using NAPS2.Scan;
using Xunit;

namespace RISpro.Scanner.Tests;

public sealed class ScannerConfigStoreTests
{
    [Fact]
    public async Task Legacy_config_defaults_to_local_and_preserves_scanner_name()
    {
        var directory = CreateTempDirectory();
        try
        {
            await File.WriteAllTextAsync(Path.Combine(directory, "config.json"), """{"DefaultScannerName":"Legacy Scanner"}""");

            var config = await new ScannerConfigStore(directory).LoadAsync();

            Assert.Equal("local", config.ScannerConnectionMode);
            Assert.Equal("", config.DefaultScannerId);
            Assert.Equal("Legacy Scanner", config.DefaultScannerName);
        }
        finally
        {
            Directory.Delete(directory, true);
        }
    }

    [Theory]
    [InlineData("")]
    [InlineData("unexpected")]
    [InlineData("LOCAL")]
    public async Task Invalid_or_local_mode_normalizes_to_local_on_load_and_save(string mode)
    {
        var directory = CreateTempDirectory();
        try
        {
            var store = new ScannerConfigStore(directory);
            var config = new ScannerAppConfig { ScannerConnectionMode = mode };

            await store.SaveAsync(config);
            var loaded = await store.LoadAsync();

            Assert.Equal("local", config.ScannerConnectionMode);
            Assert.Equal("local", loaded.ScannerConnectionMode);
        }
        finally
        {
            Directory.Delete(directory, true);
        }
    }

    [Fact]
    public async Task Config_round_trip_preserves_network_scanner_identity()
    {
        var directory = CreateTempDirectory();
        try
        {
            var store = new ScannerConfigStore(directory);
            await store.SaveAsync(new ScannerAppConfig
            {
                ScannerConnectionMode = "NETWORK",
                DefaultScannerId = "device-123",
                DefaultScannerName = "Shared Scanner",
            });

            var loaded = await store.LoadAsync();

            Assert.Equal("network", loaded.ScannerConnectionMode);
            Assert.Equal("device-123", loaded.DefaultScannerId);
            Assert.Equal("Shared Scanner", loaded.DefaultScannerName);
        }
        finally
        {
            Directory.Delete(directory, true);
        }
    }

    [Fact]
    public void Discovery_mode_preserves_default_local_and_uses_escl_for_network()
    {
        Assert.Null(Naps2ScannerService.DiscoveryDriver("local"));
        Assert.Equal(Driver.Escl, Naps2ScannerService.DiscoveryDriver("network"));
    }

    [Fact]
    public void Saved_scanner_id_is_preferred_over_name()
    {
        var devices = Devices();

        var selected = Naps2ScannerService.ResolveDevice(devices, "id-2", "First Scanner", "local");

        Assert.Equal("id-2", selected.ID);
    }

    [Theory]
    [InlineData("local")]
    [InlineData("network")]
    public void Missing_saved_id_returns_actionable_error(string mode)
    {
        var error = Assert.Throws<InvalidOperationException>(() =>
            Naps2ScannerService.ResolveDevice(Devices(), "missing-id", "First Scanner", mode));

        Assert.Contains("Refresh scanners", error.Message);
    }

    [Fact]
    public void Legacy_scanner_name_fallback_works()
    {
        var selected = Naps2ScannerService.ResolveDevice(Devices(), "", "Second Scanner", "local");

        Assert.Equal("id-2", selected.ID);
    }

    [Fact]
    public void Legacy_local_name_miss_uses_first_device_without_changing_profile()
    {
        var profile = new ScannerProfile("", "Missing Legacy Scanner", "local", 200, "grayscale", "feeder");

        var selected = Naps2ScannerService.ResolveDevice(Devices(), profile.Id, profile.Name, profile.ConnectionMode);

        Assert.Equal("id-1", selected.ID);
        Assert.Equal("", profile.Id);
        Assert.Equal("Missing Legacy Scanner", profile.Name);
    }

    [Fact]
    public void Network_name_miss_never_uses_first_device()
    {
        var error = Assert.Throws<InvalidOperationException>(() =>
            Naps2ScannerService.ResolveDevice(Devices(), "", "Missing Shared Scanner", "network"));

        Assert.Contains("NAPS2 Scanner Sharing is running", error.Message);
    }

    [Fact]
    public async Task MockScanner_creates_retryable_pdf()
    {
        var service = new MockScannerService();
        var result = await service.ScanToPdfAsync(new ScannerProfile("mock-scanner", "Mock Scanner", "local", 200, "grayscale", "feeder"), Path.GetTempPath());

        Assert.True(File.Exists(result.PdfPath));
        Assert.Equal(1, result.PageCount);
        File.Delete(result.PdfPath);
    }

    private static IReadOnlyList<ScanDevice> Devices() =>
    [
        new ScanDevice(Driver.Wia, "id-1", "First Scanner"),
        new ScanDevice(Driver.Wia, "id-2", "Second Scanner"),
    ];

    private static string CreateTempDirectory()
    {
        var directory = Path.Combine(Path.GetTempPath(), $"rispro-scanner-tests-{Guid.NewGuid():N}");
        Directory.CreateDirectory(directory);
        return directory;
    }
}
