using System.Text.Json;

namespace RISpro.Scanner.Core.Config;

public sealed class ScannerConfigStore
{
    public static readonly string ProgramDataDir = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
        "RISproScanner");

    public static readonly string ConfigPath = Path.Combine(ProgramDataDir, "config.json");
    public static readonly string LogsDir = Path.Combine(ProgramDataDir, "logs");

    public async Task<ScannerAppConfig> LoadAsync(CancellationToken cancellationToken = default)
    {
        Directory.CreateDirectory(ProgramDataDir);
        Directory.CreateDirectory(LogsDir);
        if (!File.Exists(ConfigPath)) return new ScannerAppConfig();

        await using var stream = File.OpenRead(ConfigPath);
        return await JsonSerializer.DeserializeAsync<ScannerAppConfig>(stream, cancellationToken: cancellationToken)
            ?? new ScannerAppConfig();
    }

    public async Task SaveAsync(ScannerAppConfig config, CancellationToken cancellationToken = default)
    {
        Directory.CreateDirectory(ProgramDataDir);
        Directory.CreateDirectory(LogsDir);
        await using var stream = File.Create(ConfigPath);
        await JsonSerializer.SerializeAsync(stream, config, new JsonSerializerOptions { WriteIndented = true }, cancellationToken);
    }
}
