using NAPS2.Images.Wpf;
using NAPS2.Images;
using NAPS2.Pdf;
using NAPS2.Scan;

namespace RISpro.Scanner.Core.Scanning;

public sealed class Naps2ScannerService : IScannerService
{
    public async Task<IReadOnlyList<string>> ListScannersAsync(CancellationToken cancellationToken = default)
    {
        using var context = CreateContext();
        var controller = new ScanController(context);
        var devices = await controller.GetDeviceList().WaitAsync(cancellationToken);
        return devices.Select(device => device.Name).ToList();
    }

    public async Task<ScanResult> ScanToPdfAsync(ScannerProfile profile, string outputDirectory, CancellationToken cancellationToken = default)
    {
        Directory.CreateDirectory(outputDirectory);
        using var context = CreateContext();
        var controller = new ScanController(context);
        var devices = await controller.GetDeviceList().WaitAsync(cancellationToken);
        var device = devices.FirstOrDefault(d => string.Equals(d.Name, profile.Name, StringComparison.OrdinalIgnoreCase))
            ?? devices.FirstOrDefault()
            ?? throw new InvalidOperationException("No scanner devices were found.");

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

    private static ScanningContext CreateContext()
    {
        var context = new ScanningContext(new WpfImageContext());
        context.SetUpWin32Worker();
        return context;
    }
}
