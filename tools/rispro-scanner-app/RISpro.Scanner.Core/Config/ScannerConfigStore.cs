using System.IO;
using System.Text.Json;

namespace RISpro.Scanner.Core.Config;

public sealed class ScannerConfigStore
{
    public static readonly string ProgramDataDir = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
        "RISproScanner");

    public static readonly string ConfigPath = Path.Combine(ProgramDataDir, "config.json");
    public static readonly string LogsDir = Path.Combine(ProgramDataDir, "logs");

    private readonly string _programDataDir;
    private readonly string _configPath;
    private readonly string _logsDir;

    public ScannerConfigStore(string? programDataDir = null)
    {
        _programDataDir = programDataDir ?? ProgramDataDir;
        _configPath = Path.Combine(_programDataDir, "config.json");
        _logsDir = Path.Combine(_programDataDir, "logs");
    }

    public async Task<ScannerAppConfig> LoadAsync(CancellationToken cancellationToken = default)
    {
        Directory.CreateDirectory(_programDataDir);
        Directory.CreateDirectory(_logsDir);
        if (!File.Exists(_configPath)) return new ScannerAppConfig();

        await using var stream = File.OpenRead(_configPath);
        return Normalize(await JsonSerializer.DeserializeAsync<ScannerAppConfig>(stream, cancellationToken: cancellationToken)
            ?? new ScannerAppConfig());
    }

    public async Task SaveAsync(ScannerAppConfig config, CancellationToken cancellationToken = default)
    {
        Directory.CreateDirectory(_programDataDir);
        Directory.CreateDirectory(_logsDir);
        Normalize(config);
        await using var stream = File.Create(_configPath);
        await JsonSerializer.SerializeAsync(stream, config, new JsonSerializerOptions { WriteIndented = true }, cancellationToken);
    }

    private static ScannerAppConfig Normalize(ScannerAppConfig config)
    {
        config.ScannerConnectionMode = string.Equals(config.ScannerConnectionMode, "network", StringComparison.OrdinalIgnoreCase)
            ? "network"
            : "local";
        config.DefaultScannerId ??= "";
        config.DefaultScannerName ??= "";
        return config;
    }
}
