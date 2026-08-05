using System.IO;
using NAPS2.Images.Wpf;
using NAPS2.Images;
using NAPS2.Pdf;
using NAPS2.Scan;

namespace RISpro.Scanner.Core.Scanning;

public sealed class Naps2ScannerService : IScannerService
{
    public async Task<IReadOnlyList<ScannerOption>> ListScannersAsync(string connectionMode, CancellationToken cancellationToken = default)
    {
        using var context = CreateContext();
        var controller = new ScanController(context);
        var mode = NormalizeConnectionMode(connectionMode);
        var devices = await DiscoverDevicesAsync(controller, mode, cancellationToken);
        return devices.Select(device => new ScannerOption(device.ID, device.Name, mode)).ToList();
    }

    public async Task<ScanResult> ScanToPdfAsync(ScannerProfile profile, string outputDirectory, CancellationToken cancellationToken = default)
    {
        Directory.CreateDirectory(outputDirectory);
        using var context = CreateContext();
        var controller = new ScanController(context);
        var mode = NormalizeConnectionMode(profile.ConnectionMode);
        var devices = await DiscoverDevicesAsync(controller, mode, cancellationToken);
        var device = ResolveDevice(devices, profile.Id, profile.Name, mode);

        var options = new ScanOptions
        {
            Device = device,
            Dpi = profile.Dpi,
            PaperSource = profile.Source.Equals("flatbed", StringComparison.OrdinalIgnoreCase) ? PaperSource.Flatbed : PaperSource.Feeder,
            PageSize = PageSize.A4,
        };

        var images = new List<ProcessedImage>();
        await foreach (var image in controller.Scan(options).WithCancellation(cancellationToken))
        {
            images.Add(image);
        }
        if (images.Count == 0) throw new InvalidOperationException("The scanner returned no pages.");

        var pdfPath = Path.Combine(outputDirectory, $"rispro-scan-{DateTimeOffset.UtcNow.ToUnixTimeSeconds()}.pdf");
        var exporter = new PdfExporter(context);
        await exporter.Export(pdfPath, images).WaitAsync(cancellationToken);
        return new ScanResult(pdfPath, images.Count, device.Name);
    }

    internal static string NormalizeConnectionMode(string? connectionMode) =>
        string.Equals(connectionMode, "network", StringComparison.OrdinalIgnoreCase) ? "network" : "local";

    internal static Driver? DiscoveryDriver(string? connectionMode) =>
        NormalizeConnectionMode(connectionMode) == "network" ? Driver.Escl : null;

    internal static ScanDevice ResolveDevice(IReadOnlyList<ScanDevice> devices, string? configuredId, string? configuredName, string? connectionMode)
    {
        var mode = NormalizeConnectionMode(connectionMode);
        if (!string.IsNullOrWhiteSpace(configuredId))
        {
            return devices.FirstOrDefault(device => string.Equals(device.ID, configuredId, StringComparison.Ordinal))
                ?? throw ScannerUnavailable(mode);
        }

        var namedDevice = devices.FirstOrDefault(device =>
            string.Equals(device.Name, configuredName, StringComparison.OrdinalIgnoreCase));
        if (namedDevice is not null) return namedDevice;

        if (mode == "local")
        {
            return devices.FirstOrDefault()
                ?? throw new InvalidOperationException("No scanner devices were found.");
        }

        throw ScannerUnavailable(mode);
    }

    private static async Task<IReadOnlyList<ScanDevice>> DiscoverDevicesAsync(
        ScanController controller,
        string connectionMode,
        CancellationToken cancellationToken)
    {
        var devices = DiscoveryDriver(connectionMode) is Driver driver
            ? await controller.GetDeviceList(driver).WaitAsync(cancellationToken)
            : await controller.GetDeviceList().WaitAsync(cancellationToken);
        return devices;
    }

    private static InvalidOperationException ScannerUnavailable(string connectionMode) =>
        connectionMode == "network"
            ? new InvalidOperationException("The configured network/shared scanner is unavailable. Refresh scanners and verify NAPS2 Scanner Sharing is running.")
            : new InvalidOperationException("The configured local scanner is unavailable. Refresh scanners and verify the scanner is connected.");

    private static ScanningContext CreateContext()
    {
        var context = new ScanningContext(new WpfImageContext());
        context.SetUpWin32Worker();
        return context;
    }
}
