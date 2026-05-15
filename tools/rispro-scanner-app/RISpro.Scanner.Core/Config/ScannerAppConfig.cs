namespace RISpro.Scanner.Core.Config;

public sealed class ScannerAppConfig
{
    public string RISproBaseUrl { get; set; } = "";
    public string DefaultScannerName { get; set; } = "";
    public int DPI { get; set; } = 200;
    public string ColorMode { get; set; } = "grayscale";
    public string Source { get; set; } = "feeder";
    public string LastVersion { get; set; } = "0.1.0";
    public bool AllowInsecureHttpForDev { get; set; }
}
