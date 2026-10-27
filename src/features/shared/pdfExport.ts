import { Platform } from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

/** Downloads on web, hands the file to the share sheet on a phone. */
export async function savePdf(
  bytes: Uint8Array<ArrayBuffer>,
  fileName: string,
  dialogTitle: string,
): Promise<void> {
  if (Platform.OS === 'web') {
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return;
  }

  const file = new File(Paths.cache, fileName);
  if (file.exists) file.delete();
  await file.write(bytes);
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('Sharing is not available on this device.');
  }
  await Sharing.shareAsync(file.uri, {
    mimeType: 'application/pdf',
    dialogTitle,
    UTI: 'com.adobe.pdf',
  });
}
