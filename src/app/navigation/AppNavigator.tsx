/**
 * AppNavigator
 *
 * Root navigation structure:
 *   Bottom Tab Navigator (3 tabs)
 *     ├── Compose    — draft and submit a new report
 *     ├── Outbox     — delivery queue with live status
 *     └── Server     — server-confirmed report history
 */

import React from 'react';
import { Platform } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import type { MainTabParamList } from '../../types';

import { ComposeScreen } from '../../features/reports/screens/ComposeScreen';
import { OutboxScreen } from '../../features/outbox/screens/OutboxScreen';
import { ServerReportsScreen } from '../../features/server-reports/screens/ServerReportsScreen';

const Tab = createBottomTabNavigator<MainTabParamList>();

const TAB_ICON: Record<string, string> = {
  Compose: '✏️',
  Outbox: '📤',
  ServerReports: '☁️',
};

export function AppNavigator(): React.JSX.Element {
  return (
    <NavigationContainer>
      <Tab.Navigator
        screenOptions={({ route }) => ({
          tabBarLabel: route.name === 'ServerReports' ? 'Server' : route.name,
          tabBarIcon: ({ focused }) => {
            const emoji = TAB_ICON[route.name] ?? '•';
            // Slightly enlarge focused icon
            return React.createElement(
              require('react-native').Text,
              { style: { fontSize: focused ? 24 : 20 } },
              emoji,
            );
          },
          tabBarActiveTintColor: '#2563EB',
          tabBarInactiveTintColor: '#6B7280',
          tabBarStyle: {
            backgroundColor: '#FFFFFF',
            borderTopColor: '#E5E7EB',
            paddingBottom: Platform.OS === 'android' ? 4 : 0,
          },
          headerStyle: { backgroundColor: '#2563EB' },
          headerTintColor: '#FFFFFF',
          headerTitleStyle: { fontWeight: '600' },
        })}>
        <Tab.Screen
          name="Compose"
          component={ComposeScreen}
          options={{ title: 'New Report' }}
        />
        <Tab.Screen
          name="Outbox"
          component={OutboxScreen}
          options={{ title: 'Outbox' }}
        />
        <Tab.Screen
          name="ServerReports"
          component={ServerReportsScreen}
          options={{ title: 'Server Reports' }}
        />
      </Tab.Navigator>
    </NavigationContainer>
  );
}
