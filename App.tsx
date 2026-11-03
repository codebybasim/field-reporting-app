/**
 * FieldReport — Root Component
 */
import React from 'react';
import { StatusBar, useColorScheme } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppNavigator } from './src/app/navigation/AppNavigator';
import { AppBootProvider } from './src/app/providers/AppBootProvider';

function App(): React.JSX.Element {
  const isDarkMode = useColorScheme() === 'dark';

  return (
    <SafeAreaProvider>
      <StatusBar
        barStyle={isDarkMode ? 'light-content' : 'dark-content'}
      />
      <AppBootProvider>
        <AppNavigator />
      </AppBootProvider>
    </SafeAreaProvider>
  );
}

export default App;
