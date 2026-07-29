jest.mock('@expo/vector-icons', () => {
  const React = require('react')
  const { Text } = require('react-native')

  return {
    Ionicons: ({ name }: { name: string }) => React.createElement(Text, { accessibilityLabel: name }),
  }
})
