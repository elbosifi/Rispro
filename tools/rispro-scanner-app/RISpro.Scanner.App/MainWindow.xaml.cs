using System.IO;
using System.Net.Http;
using System.Windows;
using System.Windows.Controls;
using RISpro.Scanner.Core.Api;
using RISpro.Scanner.Core.Config;
using RISpro.Scanner.Core.Scanning;

namespace RISpro.Scanner.App;

public partial class MainWindow : Window
{
    private const string AppVersion = "0.1.0";
    private readonly ScannerConfigStore _configStore = new();
    private readonly IScannerService _scannerService = new Naps2ScannerService();
    private ScannerAppConfig _config = new();
    private string? _token;
    private ScanSessionContext? _context;
    private ScanResult? _lastScan;
    private bool _isApplyingScannerUi;
    private bool _connectionModeChangedByUser;
    private bool _scannerSelectionChangedByUser;

    public MainWindow()
    {
        InitializeComponent();
        Loaded += MainWindow_Loaded;
    }

    private async void MainWindow_Loaded(object sender, RoutedEventArgs e)
    {
        _config = await _configStore.LoadAsync();
        _token = (Application.Current as App)?.LaunchToken;
        ApplyConfigToUi();
        await RefreshScannersAsync();
        if (!string.IsNullOrWhiteSpace(_token))
        {
            await LoadContextAsync();
        }
    }

    private void ApplyConfigToUi()
    {
        _isApplyingScannerUi = true;
        BaseUrlTextBox.Text = _config.RISproBaseUrl;
        AllowHttpCheckBox.IsChecked = _config.AllowInsecureHttpForDev;
        SetConnectionMode(_config.ScannerConnectionMode);
        SetComboValue(DpiComboBox, _config.DPI.ToString());
        SetComboValue(ColorModeComboBox, _config.ColorMode);
        SetComboValue(SourceComboBox, _config.Source);
        _isApplyingScannerUi = false;
    }

    private ScannerAppConfig ReadConfigFromUi(bool saveScannerSetup)
    {
        var config = new ScannerAppConfig
        {
            RISproBaseUrl = BaseUrlTextBox.Text.Trim().TrimEnd('/'),
            ScannerConnectionMode = _config.ScannerConnectionMode,
            DefaultScannerId = _config.DefaultScannerId,
            DefaultScannerName = _config.DefaultScannerName,
            DPI = int.TryParse(GetComboValue(DpiComboBox), out var dpi) ? dpi : 200,
            ColorMode = GetComboValue(ColorModeComboBox),
            Source = GetComboValue(SourceComboBox),
            LastVersion = AppVersion,
            AllowInsecureHttpForDev = AllowHttpCheckBox.IsChecked == true,
        };

        if (!saveScannerSetup) return config;

        config.ScannerConnectionMode = GetConnectionMode();
        if (_scannerSelectionChangedByUser && ScannerComboBox.SelectedItem is ScannerOption selectedScanner)
        {
            config.DefaultScannerId = selectedScanner.Id;
            config.DefaultScannerName = selectedScanner.DisplayName;
        }
        else if (_connectionModeChangedByUser)
        {
            config.DefaultScannerId = "";
            config.DefaultScannerName = "";
        }
        return config;
    }

    private async Task<RisproScannerApiClient> CreateClientAsync()
    {
        _config = ReadConfigFromUi(false);
        if (string.IsNullOrWhiteSpace(_config.RISproBaseUrl)) throw new InvalidOperationException("Configure RISpro server URL first.");
        var baseUri = new Uri(_config.RISproBaseUrl);
        if (baseUri.Scheme != Uri.UriSchemeHttps && !_config.AllowInsecureHttpForDev)
        {
            throw new InvalidOperationException("HTTPS is required unless local development HTTP is explicitly enabled.");
        }
        await _configStore.SaveAsync(_config);
        return new RisproScannerApiClient(new HttpClient { BaseAddress = baseUri, Timeout = TimeSpan.FromMinutes(3) });
    }

    private async Task LoadContextAsync()
    {
        try
        {
            var client = await CreateClientAsync();
            _context = await client.GetContextAsync(_token!);
            await client.MarkOpenedAsync(_token!, Environment.MachineName, AppVersion);
            ContextTextBlock.Text =
                $"Patient: {_context.Patient.EnglishFullName} / {_context.Patient.ArabicFullName}\n" +
                $"Patient ID: {_context.Patient.Id}\n" +
                $"Appointment: {_context.Appointment.AppointmentDate} | {_context.Appointment.ModalityName} | {_context.Appointment.ExamTypeName}\n" +
                $"Accession: {_context.Appointment.AccessionNumber}";
            SetStatus("Scan session loaded. Confirm the identity before scanning.");
        }
        catch (Exception ex)
        {
            SetStatus($"Failed to load scan session: {ex.Message}");
        }
    }

    private async void RefreshScanners_Click(object sender, RoutedEventArgs e) => await RefreshScannersAsync();

    private void ScannerConnectionComboBox_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_isApplyingScannerUi || !IsLoaded) return;
        _connectionModeChangedByUser = true;
        _scannerSelectionChangedByUser = false;
        _isApplyingScannerUi = true;
        ScannerComboBox.Items.Clear();
        ScannerComboBox.SelectedItem = null;
        _isApplyingScannerUi = false;
    }

    private void ScannerComboBox_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_isApplyingScannerUi || !IsLoaded) return;
        _scannerSelectionChangedByUser = ScannerComboBox.SelectedItem is ScannerOption;
    }

    private async Task RefreshScannersAsync()
    {
        try
        {
            var mode = GetConnectionMode();
            var scanners = await _scannerService.ListScannersAsync(mode);
            _isApplyingScannerUi = true;
            ScannerComboBox.Items.Clear();
            foreach (var scanner in scanners)
            {
                ScannerComboBox.Items.Add(scanner);
            }
            if (string.Equals(mode, _config.ScannerConnectionMode, StringComparison.OrdinalIgnoreCase))
            {
                ScannerComboBox.SelectedItem = !string.IsNullOrWhiteSpace(_config.DefaultScannerId)
                    ? scanners.FirstOrDefault(scanner => string.Equals(scanner.Id, _config.DefaultScannerId, StringComparison.Ordinal))
                    : scanners.FirstOrDefault(scanner => string.Equals(scanner.DisplayName, _config.DefaultScannerName, StringComparison.OrdinalIgnoreCase));
            }
            _isApplyingScannerUi = false;
        }
        catch (Exception ex)
        {
            SetStatus($"Scanner discovery failed: {ex.Message}");
        }
    }

    private async void SaveSetup_Click(object sender, RoutedEventArgs e)
    {
        _config = ReadConfigFromUi(true);
        await _configStore.SaveAsync(_config);
        _connectionModeChangedByUser = false;
        _scannerSelectionChangedByUser = false;
        SetStatus("Setup saved.");
    }

    private async void TestScan_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            _lastScan = await ScanAsync();
            PreviewTextBlock.Text = $"{_lastScan.PageCount} page(s): {_lastScan.PdfPath}";
            SetStatus("Test scan complete. It was not uploaded.");
        }
        catch (Exception ex)
        {
            SetStatus($"Test scan failed: {ex.Message}");
        }
    }

    private async void Scan_Click(object sender, RoutedEventArgs e)
    {
        if (!EnsureIdentityConfirmed()) return;
        try
        {
            _lastScan = await ScanAsync();
            PreviewTextBlock.Text = $"{_lastScan.PageCount} page(s): {_lastScan.PdfPath}";
            SetStatus("Scan complete. Review the appointment identity and upload when ready.");
        }
        catch (Exception ex)
        {
            SetStatus($"Scan failed: {ex.Message}");
        }
    }

    private async Task<ScanResult> ScanAsync()
    {
        _config = ReadConfigFromUi(false);
        await _configStore.SaveAsync(_config);
        var selectedScanner = ScannerComboBox.SelectedItem as ScannerOption;
        var selectedMode = GetConnectionMode();
        var scannerId = selectedScanner?.Id
            ?? (string.Equals(selectedMode, _config.ScannerConnectionMode, StringComparison.OrdinalIgnoreCase) ? _config.DefaultScannerId : "");
        var scannerName = selectedScanner?.DisplayName
            ?? (string.Equals(selectedMode, _config.ScannerConnectionMode, StringComparison.OrdinalIgnoreCase) ? _config.DefaultScannerName : "");
        var tempDir = Path.Combine(ScannerConfigStore.ProgramDataDir, "temp");
        return await _scannerService.ScanToPdfAsync(
            new ScannerProfile(scannerId, scannerName, selectedMode, _config.DPI, _config.ColorMode, _config.Source),
            tempDir);
    }

    private async void Upload_Click(object sender, RoutedEventArgs e)
    {
        if (!EnsureIdentityConfirmed()) return;
        if (string.IsNullOrWhiteSpace(_token))
        {
            SetStatus("No scan token is loaded. Start from RISpro with Scan Paper.");
            return;
        }
        if (_lastScan is null || !File.Exists(_lastScan.PdfPath))
        {
            SetStatus("Scan a document before upload.");
            return;
        }

        try
        {
            var client = await CreateClientAsync();
            await client.UploadAsync(
                _token,
                _lastScan.PdfPath,
                new UploadMetadata(GetComboValue(DocumentTypeComboBox), _lastScan.PageCount, _lastScan.ScannerName, Environment.MachineName, AppVersion));
            _token = null;
            SetStatus("Upload complete. Token cleared.");
        }
        catch (Exception ex)
        {
            SetStatus($"Upload failed. The scanned PDF remains available for retry: {ex.Message}");
        }
    }

    private async void Cancel_Click(object sender, RoutedEventArgs e)
    {
        if (string.IsNullOrWhiteSpace(_token)) return;
        try
        {
            var client = await CreateClientAsync();
            await client.CancelAsync(_token, "Cancelled by workstation user.");
            _token = null;
            SetStatus("Scan session cancelled.");
        }
        catch (Exception ex)
        {
            SetStatus($"Cancel failed: {ex.Message}");
        }
    }

    private bool EnsureIdentityConfirmed()
    {
        if (_context is not null && ConfirmIdentityCheckBox.IsChecked != true)
        {
            SetStatus("Confirm patient and appointment identity before scanning or uploading.");
            return false;
        }
        return true;
    }

    private void SetStatus(string message) => StatusTextBlock.Text = message;

    private static string GetComboValue(ComboBox comboBox) =>
        (comboBox.SelectedItem as ComboBoxItem)?.Content?.ToString() ?? comboBox.Text.Trim();

    private static void SetComboValue(ComboBox comboBox, string value)
    {
        foreach (var item in comboBox.Items.OfType<ComboBoxItem>())
        {
            if (string.Equals(item.Content?.ToString(), value, StringComparison.OrdinalIgnoreCase))
            {
                comboBox.SelectedItem = item;
                return;
            }
        }
        comboBox.Text = value;
    }

    private string GetConnectionMode() =>
        (ScannerConnectionComboBox.SelectedItem as ComboBoxItem)?.Tag?.ToString() == "network" ? "network" : "local";

    private void SetConnectionMode(string connectionMode)
    {
        var normalizedMode = string.Equals(connectionMode, "network", StringComparison.OrdinalIgnoreCase) ? "network" : "local";
        ScannerConnectionComboBox.SelectedItem = ScannerConnectionComboBox.Items
            .OfType<ComboBoxItem>()
            .First(item => string.Equals(item.Tag?.ToString(), normalizedMode, StringComparison.Ordinal));
    }
}
