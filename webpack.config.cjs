const path = require('path');
const TerserPlugin = require('terser-webpack-plugin');
const isProduction = process.env.NODE_ENV === 'production';

module.exports = {
    mode: isProduction ? 'production' : 'development',
    entry: path.join(__dirname, 'src/index.ts'),
    output: {
        path: path.join(__dirname, 'dist/'),
        filename: 'index.js',
        devtoolNamespace: 'sillytavern-magic-translation',
        library: {
            type: 'module'
        }
    },
    experiments: {
        outputModule: true
    },
    externalsType: 'module',
    externals: [
        function({ context, request }, callback) {
            if (request.includes('../../..')) {
                // Return the path as an external module import
                return callback(null, `module ${request}`);
            }
            // Continue without externalizing the import
            callback();
        },
    ],
    resolve: {
        extensions: ['.ts', '.tsx', '.js', '.jsx'],
        extensionAlias: {
            '.js': ['.ts', '.js']
        }
    },
    devtool: isProduction ? false : 'source-map',
    module: {
        rules: [
            {
                test: /\.(ts|tsx|js|jsx)$/,
                exclude: /node_modules/,
                use: [
                    ...(isProduction ? [{
                        loader: 'babel-loader',
                        options: {
                            cacheDirectory: true,
                            presets: [
                                '@babel/preset-env',
                                '@babel/preset-typescript',
                            ],
                        },
                    }] : []),
                    {
                        loader: 'ts-loader',
                        options: {
                            transpileOnly: !isProduction,
                        },
                    },
                ],
            },
        ],
    },
    optimization: {
        minimize: process.env.NODE_ENV === 'production',
        minimizer: [new TerserPlugin({
            extractComments: false,
        })],
    },
}
