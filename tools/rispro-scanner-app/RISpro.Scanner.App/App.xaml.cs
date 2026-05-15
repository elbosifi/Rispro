using System.IO;
using System.Windows;

namespace RISpro.Scanner.App;

public partial class App : Application
{
    public string? LaunchToken { get; private set; }

    protected override void OnStartup(StartupEventArgs e)
    {
        Directory.SetCurrentDirectory(AppContext.BaseDirectory);
        base.OnStartup(e);
        LaunchToken = e.Args.Select(RISpro.Scanner.Core.Protocol.ScannerProtocol.TryParseToken)
            .FirstOrDefault(token => !string.IsNullOrWhiteSpace(token));
    }
}
